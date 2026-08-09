import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { HttpException, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BumpRunOutcome, BumpScheduleStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_BUMP_AUTO } from '../../infra/queue/queue.constants';
import { BillingService } from '../billing/billing.service';
import { BumpAutoNotificationsService } from './bump-auto-notifications.service';
import { BUMP_AUTO_JOB, type RunTurnJobData } from './bump-auto.job';
import { computeNextRunAt } from './next-run';

/**
 * Consumidor de QUEUE_BUMP_AUTO: ejecuta UN turno ya reclamado.
 *
 * El scheduler ya hizo lo delicado —tomar la slot y crear el `BumpRun` que impide que nadie
 * más ejecute este turno—. Aquí solo se cobra y se registra el desenlace.
 *
 * NO REPLICA EL COBRO: llama a `BillingService.bump`, que valida (propiedad, ACTIVE,
 * cooldown), elige la bolsa en el orden confirmado (D11: cuota Pro → saldo de bumps →
 * créditos, el MISMO que el bump manual), lee el precio en vivo (D10) y escribe todo en una
 * transacción. De ahí salen las excepciones tipadas que este fichero traduce a política.
 *
 * POR QUÉ NO PUEDE COBRAR DOS VECES, aunque este job se reintente: la CAPA 1 hizo que
 * `bump()` reclame la ventana de cooldown con un UPDATE condicional ANTES de cobrar. Un
 * reintento llega segundos después (backoff exponencial desde 2 s, 3 intentos), muy dentro de
 * la ventana de 3600 s, así que choca con el cooldown recién escrito y sale por 429 sin
 * cobrar. Y eso es solo la tercera línea de defensa, por detrás del reclamo en base y del
 * jobId estable.
 */
@Processor(QUEUE_BUMP_AUTO)
export class BumpAutoProcessor extends WorkerHost {
  private readonly logger = new Logger(BumpAutoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly notifications: BumpAutoNotificationsService,
  ) {
    super();
  }

  /**
   * Adaptador fino, igual que el `@Cron` del scheduler: saca los datos del job y pone la
   * fecha. Toda la lógica vive en `runTurn`, que la RECIBE.
   */
  async process(job: Job): Promise<void> {
    if (job.name !== BUMP_AUTO_JOB.RUN_TURN) {
      this.logger.warn(`Unknown bump-auto job: ${job.name}`);
      return;
    }
    await this.runTurn(job.data as RunTurnJobData, new Date(), {
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts ?? 1,
    });
  }

  /**
   * Ejecuta un turno ya reclamado. PÚBLICO Y CON EL RELOJ FUERA: el avance de `nextRunAt` se
   * ancla al turno previsto y hay que poder verificar que no deriva, cosa imposible si la
   * fecha se consulta aquí dentro. Misma lección que el cron de tickets.
   *
   * Devuelve el desenlace registrado, o `null` si no había nada que hacer.
   */
  async runTurn(
    data: RunTurnJobData,
    now: Date,
    retry: { attemptsMade: number; attempts: number } = { attemptsMade: 0, attempts: 1 },
  ): Promise<BumpRunOutcome | null> {
    const run = await this.prisma.bumpRun.findUnique({
      where: { id: data.runId },
      select: { id: true, slot: true, outcome: true, scheduleId: true },
    });
    // Turno ya resuelto (reintento tardío de un job cuyo trabajo terminó): nada que hacer.
    if (!run || run.outcome !== null) return null;

    const schedule = await this.prisma.bumpSchedule.findUnique({
      where: { id: run.scheduleId },
      select: {
        id: true,
        listingId: true,
        userId: true,
        intervalDays: true,
        hourOfDay: true,
        status: true,
        listing: { select: { title: true } },
      },
    });
    if (!schedule) return null; // la programación (y su anuncio) desaparecieron entre medias

    try {
      const resultado = await this.billing.bump(schedule.listingId, schedule.userId);

      await this.resolve(run.id, {
        outcome: BumpRunOutcome.APPLIED,
        paidWith: resultado.paidWith,
        cost: resultado.cost,
      });
      // D6 — un bump aplicado NO notifica: es lo que el usuario contrató, y avisar de cada
      // uno inundaría la campana. Queda registrado en BumpRun, que es donde se pregunta.
      await this.advance(schedule, run.slot, now);

      this.logger.log(
        `Bump automático aplicado: listing=${schedule.listingId} ` +
          `slot=${run.slot.toISOString()} paidWith=${resultado.paidWith} cost=${resultado.cost}`,
      );
      return BumpRunOutcome.APPLIED;
    } catch (err) {
      return this.handleFailure(err, retry, run.id, run.slot, schedule, now);
    }
  }

  /**
   * Traduce lo que devolvió `bump()` a las políticas CONFIRMADAS.
   *
   * Cada rama decide dos cosas independientes: qué se registra en el turno y qué le pasa a la
   * programación. La distinción SKIPPED / FAILED no es cosmética — solo los FAILED pausan.
   */
  private async handleFailure(
    err: unknown,
    retry: { attemptsMade: number; attempts: number },
    runId: string,
    slot: Date,
    schedule: {
      id: string;
      listingId: string;
      userId: string;
      intervalDays: number;
      hourOfDay: number;
      listing: { title: string };
    },
    now: Date,
  ): Promise<BumpRunOutcome> {
    const status = err instanceof HttpException ? err.getStatus() : 0;

    // D2 — sin saldo: se agotaron las TRES bolsas. Se PAUSA y se avisa; la reanudación es
    // MANUAL a propósito, porque los créditos son una bolsa común y recargarlos para otra
    // cosa no debe reactivar un gasto que el usuario no ha vuelto a pedir. `nextRunAt` no
    // avanza: la programación se queda donde estaba, esperando una decisión.
    if (status === 402) {
      await this.resolve(runId, {
        outcome: BumpRunOutcome.FAILED_NO_FUNDS,
        detail: 'Sin cuota Pro, saldo de bumps ni créditos suficientes',
      });
      await this.pause(schedule.id, BumpScheduleStatus.PAUSED_NO_FUNDS, now);
      await this.notifications.pausedNoFunds(schedule.userId, {
        scheduleId: schedule.id,
        listingId: schedule.listingId,
        listingTitle: schedule.listing.title,
      });
      this.logger.log(`Bump automático pausado por falta de saldo: schedule=${schedule.id}`);
      return BumpRunOutcome.FAILED_NO_FUNDS;
    }

    // D5 — colisión con el bump manual. El usuario acaba de subir el anuncio a mano y la
    // ventana sigue abierta, así que este turno sobra: se salta SIN COBRAR y sin avisar
    // (contarle que no se bumpeó porque ya bumpeó él sería ruido). El calendario NO se
    // recalcula desde el bump manual: «cada 3 días a las 9:00» es un calendario, y un
    // calendario no se mueve porque hoy hayas hecho algo a mano.
    if (status === 429) {
      await this.resolve(runId, {
        outcome: BumpRunOutcome.SKIPPED_COOLDOWN,
        detail: 'Bump reciente dentro de la ventana de cooldown',
      });
      await this.advance(schedule, slot, now);
      return BumpRunOutcome.SKIPPED_COOLDOWN;
    }

    // D9 — el anuncio dejó de estar ACTIVE (vendido, archivado, caducado, moderado). Se
    // pausa y se avisa, no se borra: castigar al usuario por vender sería absurdo, y dejarla
    // intentándolo a diario crearía las programaciones zombis que la auditoría anticipó. La
    // reanudación de ESTE caso sí es automática (llega con la UI), porque reactivar el
    // anuncio es un gesto sobre el mismo objeto que la programación.
    if (status === 400 || status === 403 || status === 404) {
      await this.resolve(runId, {
        outcome: BumpRunOutcome.SKIPPED_LISTING_INACTIVE,
        detail: 'El anuncio no estaba activo al ejecutar el turno',
      });
      await this.pause(schedule.id, BumpScheduleStatus.PAUSED_LISTING_INACTIVE, now);
      await this.notifications.pausedListingInactive(schedule.userId, {
        scheduleId: schedule.id,
        listingId: schedule.listingId,
        listingTitle: schedule.listing.title,
      });
      this.logger.log(`Bump automático pausado por anuncio inactivo: schedule=${schedule.id}`);
      return BumpRunOutcome.SKIPPED_LISTING_INACTIVE;
    }

    // Cualquier otra cosa. Mientras queden reintentos se deja que la cola lo reintente (el
    // turno sigue reclamado y sin resolver, así que nadie más lo tocará). Agotados, se
    // registra el fallo y se AVANZA el turno: se pierde este, pero la programación no se
    // queda encallada esperando un turno que ya nadie va a resolver.
    Sentry.captureException(err);
    const intentosMax = retry.attempts;
    if (retry.attemptsMade + 1 < intentosMax) throw err;

    await this.resolve(runId, {
      outcome: BumpRunOutcome.FAILED_ERROR,
      detail: err instanceof Error ? err.message.slice(0, 200) : 'Error desconocido',
    });
    await this.advance(schedule, slot, now);
    this.logger.error(`Bump automático falló tras ${intentosMax} intentos: schedule=${schedule.id}`);
    return BumpRunOutcome.FAILED_ERROR;
  }

  /** Escribe el desenlace en el turno reclamado. */
  private resolve(
    runId: string,
    data: { outcome: BumpRunOutcome; paidWith?: string; cost?: number; detail?: string },
  ) {
    return this.prisma.bumpRun.update({ where: { id: runId }, data });
  }

  /**
   * Mueve la programación a su siguiente turno.
   *
   * ANCLADO AL TURNO PREVISTO (`slot`), no a `now`: si la pasada llegó tarde, el turno
   * siguiente no se corre. Es la propiedad anti-deriva, y es también lo que hace que dos
   * instancias calculen lo mismo.
   */
  private advance(
    schedule: { id: string; intervalDays: number; hourOfDay: number },
    slot: Date,
    now: Date,
  ) {
    return this.prisma.bumpSchedule.update({
      where: { id: schedule.id },
      data: {
        nextRunAt: computeNextRunAt(slot, schedule.intervalDays, schedule.hourOfDay, now),
        lastRunAt: now,
      },
    });
  }

  /** Pausa sin tocar `nextRunAt`: la programación se queda donde estaba. */
  private pause(scheduleId: string, status: BumpScheduleStatus, now: Date) {
    return this.prisma.bumpSchedule.update({
      where: { id: scheduleId },
      data: { status, lastRunAt: now },
    });
  }
}
