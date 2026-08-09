import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BumpScheduleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_BUMP_AUTO } from '../../infra/queue/queue.constants';
import { BUMP_AUTO_JOB, bumpAutoJobId, type RunTurnJobData } from './bump-auto.job';
import { BUMP_SCHEDULE_TIMEZONE } from './next-run';

/** Setting (D7) — interruptor de emergencia. Sin fila, la feature está encendida. */
export const BUMP_AUTO_ENABLED_SETTING = 'bumpAutoEnabled';

/** Tope de turnos reclamados por pasada. Ver el comentario en `runDueSchedules`. */
export const MAX_TURNS_PER_PASS = 500;

export interface BumpSchedulePassResult {
  enabled: boolean;
  /** Programaciones con turno vencido que se han mirado en esta pasada. */
  due: number;
  /** Turnos reclamados por ESTA pasada y encolados. */
  claimed: number;
  /** Turnos que ya tenía otro: la idempotencia haciendo su trabajo, no un error. */
  alreadyClaimed: number;
  /** Se alcanzó el tope de la pasada y quedan turnos vencidos para la siguiente. */
  truncated: boolean;
}

/**
 * Bump automático — EL SCHEDULER (ráfaga 3).
 *
 * Molde `InvoicingScheduleService`, con sus cuatro propiedades: el `@Cron` es fino y delega
 * en un método público que RECIBE LA FECHA, el trabajo va a una cola en vez de ejecutarse
 * dentro del tick, la recuperación se pregunta por ESTADO («¿hay turnos vencidos?») y no por
 * calendario, y la idempotencia es explícita.
 *
 * ESTE SERVICIO NO SABE COBRAR. Sabe CUÁNDO. Todo lo que es «hacer un bump» —validar,
 * elegir bolsa, cobrar, escribir, reindexar, invalidar caché— vive en `BillingService.bump` y
 * no se replica aquí; lo llama el processor. Si algún día este fichero contuviera lógica de
 * cobro, estaría mal.
 *
 * EL ORDEN DE UNA PASADA, que es donde vive la garantía:
 *   1. SELECCIONAR los turnos vencidos (status ACTIVE + nextRunAt <= now).
 *   2. TOMAR LA SLOT: el `nextRunAt` que la fila tiene AHORA, copiado tal cual y antes de
 *      tocar nada (el corolario que dejó escrito la ráfaga 2 junto a la columna).
 *   3. RECLAMAR: crear el `BumpRun` de ese `(scheduleId, slot)`. Si choca con la clave
 *      única, otro se lo quedó y esta pasada se retira sin ruido.
 *   4. ENCOLAR el cobro, con `jobId` estable.
 * Reclamar ANTES de cobrar es lo que convierte «un turno = un cobro» en una propiedad del
 * sistema y no en una promesa: quien no consigue insertar la fila, no llega a cobrar nunca.
 */
@Injectable()
export class BumpScheduleService {
  private readonly logger = new Logger(BumpScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_BUMP_AUTO) private readonly queue: Queue,
  ) {}

  /**
   * Cada hora, en el minuto 10.
   *
   * HORARIO: los cuatro `@Cron` que ya existen corren todos en minuto 0 (02:00, 03:00, 04:00
   * y 05:00). Un cron horario en minuto 0 se solaparía con ellos cuatro veces al día sin
   * ninguna necesidad; el precedente de separarlos ya lo sentó el cron de tickets al ponerse
   * una hora después del de facturación.
   *
   * ZONA: declarada, no heredada del proceso. `hourOfDay` es hora peninsular (D4) y este es
   * el único sitio donde el reloj del sistema entra en juego, así que aquí se dice en qué
   * zona se está pensando en vez de depender de cómo esté configurada la máquina.
   */
  @Cron('10 * * * *', { timeZone: BUMP_SCHEDULE_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.runDueSchedules(new Date());
  }

  /**
   * Punto de entrada PÚBLICO Y TESTEABLE: recibe el instante, nunca lo consulta.
   *
   * Es la lección que dejó el cron de tickets, y aquí no es opcional: los casos que hay que
   * poder verificar —el turno justo en la frontera, dos instancias en el mismo segundo, la
   * pasada que llega tarde— son exactamente los que no se pueden provocar esperando al
   * reloj. Un scheduler que gasta dinero y solo se prueba esperando es una bomba de
   * relojería.
   */
  async runDueSchedules(now: Date): Promise<BumpSchedulePassResult> {
    if (!(await this.isEnabled())) {
      this.logger.debug('Bump automático desactivado por ajuste; no se procesa nada.');
      return { enabled: false, due: 0, claimed: 0, alreadyClaimed: 0, truncated: false };
    }

    // La consulta para la que la ráfaga 2 creó @@index([status, nextRunAt]).
    //
    // TOPE POR PASADA: se piden MAX_TURNS_PER_PASS + 1 para saber si quedan más. No es un
    // recorte silencioso —`truncated` lo dice y se registra en el log—: es que una pasada no
    // debe poder encolar una cantidad no acotada de cobros. Lo que sobra no se pierde, sale
    // en la siguiente pasada, porque la selección se hace por ESTADO y no por calendario.
    const vencidas = await this.prisma.bumpSchedule.findMany({
      where: { status: BumpScheduleStatus.ACTIVE, nextRunAt: { lte: now } },
      select: { id: true, nextRunAt: true, listingId: true, userId: true },
      orderBy: { nextRunAt: 'asc' },
      take: MAX_TURNS_PER_PASS + 1,
    });

    const truncated = vencidas.length > MAX_TURNS_PER_PASS;
    const aProcesar = truncated ? vencidas.slice(0, MAX_TURNS_PER_PASS) : vencidas;

    let claimed = 0;
    let alreadyClaimed = 0;

    for (const programacion of aProcesar) {
      // La SLOT se toma aquí: es el `nextRunAt` vigente, copiado tal cual. No se recalcula
      // ni se trunca ni se deriva de `now`, porque de eso depende que dos instancias que
      // miran la misma fila obtengan el mismo valor y choquen en la clave única.
      const slot = programacion.nextRunAt;

      const reclamado = await this.claimTurn(programacion.id, slot);
      if (!reclamado) {
        alreadyClaimed++;
        continue;
      }

      await this.queue.add(
        BUMP_AUTO_JOB.RUN_TURN,
        {
          scheduleId: programacion.id,
          runId: reclamado,
          slot: slot.toISOString(),
        } satisfies RunTurnJobData,
        // Segundo guard: mismo turno, mismo jobId. Si dos pasadas llegaran a reclamar y
        // encolar (no pueden, pero el guard no depende de eso), BullMQ no crea dos jobs.
        { jobId: bumpAutoJobId(programacion.id, slot) },
      );
      claimed++;
    }

    if (claimed > 0 || alreadyClaimed > 0 || truncated) {
      this.logger.log(
        `Bump automático: ${aProcesar.length} vencidos, ${claimed} reclamados, ` +
          `${alreadyClaimed} ya tomados por otra instancia` +
          (truncated ? `, tope de ${MAX_TURNS_PER_PASS} alcanzado (el resto, en la siguiente pasada)` : ''),
      );
    }

    return { enabled: true, due: aProcesar.length, claimed, alreadyClaimed, truncated };
  }

  /**
   * Reclama el turno creando su `BumpRun`. Devuelve el id de la fila si el turno es nuestro,
   * o `null` si ya lo tenía otro.
   *
   * ESTE INSERT ES EL RECLAMO. El `@@unique([scheduleId, slot])` que creó la ráfaga 2 hace
   * que solo una de N instancias pueda crear la fila; las demás reciben P2002 y se retiran.
   * Que el guard viva en la BASE y no en una comprobación previa es lo que lo hace
   * infranqueable: no hay ventana entre «miro si existe» y «lo creo».
   *
   * La fila nace con `outcome` NULL —reclamado, sin desenlace— y el processor la resuelve.
   */
  private async claimTurn(scheduleId: string, slot: Date): Promise<string | null> {
    try {
      const run = await this.prisma.bumpRun.create({
        data: { scheduleId, slot },
        select: { id: true },
      });
      return run.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // No es un error: es la idempotencia funcionando. Otra instancia llegó primero.
        return null;
      }
      throw err;
    }
  }

  /** D7 — sin fila, encendido. El ajuste es un interruptor de emergencia, no un requisito. */
  private async isEnabled(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: BUMP_AUTO_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste ? ajuste.value !== false : true;
  }
}
