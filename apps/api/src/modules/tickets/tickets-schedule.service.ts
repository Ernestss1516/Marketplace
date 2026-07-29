import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TicketsService } from './tickets.service';

/** Resumen de una corrida, para observabilidad y para los tests. */
export interface TicketAutoCloseResult {
  windowDays: number;
  cutoff: Date;
  /** Tickets que el query marcó como vencidos. */
  candidates: number;
  /** Cerrados de verdad (puede ser < candidates si alguno cambió de estado en medio). */
  closed: number;
  /** ANOMALÍA: RESOLVED sin `resolvedAt`. No se cierran; se cuentan para que se vean. */
  orphanResolved: number;
}

/**
 * Atención al usuario R8 — CIERRE AUTOMÁTICO de los tickets RESOLVED vencidos (T9).
 *
 * Cierra la última transición de la matriz §7.2 que no tenía quien la disparara:
 * hasta ahora la ventana solo la hacía cumplir el guard de reapertura, así que
 * los RESOLVED se acumulaban indefinidamente y la bandeja se iba ensuciando.
 *
 * Molde `InvoicingScheduleService`: el `@Cron` es fino y delega en un método
 * público que RECIBE LA FECHA — la lógica nunca llama a `new Date()` por dentro,
 * y por eso se puede probar el día 13, el 14 y el 15 sin esperar al reloj.
 *
 * NO reimplementa la transición: llama a `TicketsService.closeExpired`, que pasa
 * por el mismo `closeCore` que el cierre manual (molde `emitInvoiceCore`). El
 * guard `CLOSABLE` y la escritura de `closedAt`/`closedById` viven en un solo
 * sitio, no en dos que puedan divergir.
 */
@Injectable()
export class TicketsScheduleService {
  private readonly logger = new Logger(TicketsScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  /**
   * Diario a las 05:00 — una hora después del cron de facturación (04:00) para
   * no solaparlos en la misma máquina; ninguno de los dos es urgente al minuto.
   */
  @Cron('0 5 * * *')
  async handleCron(): Promise<void> {
    await this.runTicketAutoClose(new Date());
  }

  /**
   * Punto de entrada testeable. Cierra los RESOLVED cuya ventana ya venció.
   *
   * IDEMPOTENCIA NATURAL, sin marca de "última corrida" (a diferencia del cron de
   * facturación, que sí la necesita porque su unidad de trabajo es un PERIODO que
   * no deja rastro en la fila): aquí el propio query se autolimita. Un ticket ya
   * cerrado tiene `status = CLOSED` y deja de casar `status = RESOLVED`, así que
   * un segundo disparo el mismo día no lo vuelve a tocar. El estado de la fila ES
   * la marca. Añadir un Setting de "último día procesado" sería estado redundante
   * que puede desincronizarse del único dato que manda.
   *
   * FRONTERA: `resolvedAt <= now - windowDays` — a los 14 días EXACTOS ya cierra
   * (comparación inclusiva). Es coherente con el guard de reapertura, que exige
   * `now <= resolvedAt + ventana` para dejar reabrir: en el instante exacto del
   * vencimiento el usuario ya no puede reabrir, así que el cron sí puede cerrar.
   * No queda ningún hueco entre los dos.
   */
  async runTicketAutoClose(now: Date): Promise<TicketAutoCloseResult> {
    // La ventana la resuelve TicketsService: mismo valor que usa el guard de T8.
    const windowDays = await this.tickets.getReopenWindowDays();
    const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const vencidos = await this.prisma.ticket.findMany({
      where: { status: 'RESOLVED', resolvedAt: { lte: cutoff } },
      select: { id: true },
    });

    // ANOMALÍA que no debería existir (resolve() siempre escribe resolvedAt). El
    // `lte` de arriba ya excluye los NULL por semántica de SQL, así que no se
    // cierran — pero se CUENTAN y se avisan, en vez de barrerse en silencio:
    // mismo criterio de "falla alto, no autocorrijas" que el resto del proyecto.
    // Un RESOLVED sin fecha es un ticket que nunca se cerrará solo, y eso hay que
    // poder verlo.
    const orphanResolved = await this.prisma.ticket.count({
      where: { status: 'RESOLVED', resolvedAt: null },
    });
    if (orphanResolved > 0) {
      this.logger.warn(
        `Auto-cierre de tickets: ${orphanResolved} ticket(s) en RESOLVED SIN resolvedAt. ` +
          'No se cierran (no hay desde cuándo contar la ventana) y nunca se cerrarán solos. ' +
          'Revisar: resolve() siempre debería escribir resolvedAt.',
      );
    }

    let closed = 0;
    for (const { id } of vencidos) {
      // Devuelve null si dejó de estar RESOLVED entre el query y el UPDATE (un
      // agente lo cerró, o el usuario lo reabrió). No es un error: es la carrera
      // que `requireStatus` está para ganar.
      if (await this.tickets.closeExpired(id, now)) closed++;
    }

    if (closed > 0 || vencidos.length > 0) {
      // UN SOLO log de resumen por corrida, no uno por ticket — ver la decisión
      // sobre AuditLog más abajo, que sigue el mismo criterio.
      this.logger.log(
        `Auto-cierre de tickets: ${closed}/${vencidos.length} cerrados ` +
          `(ventana ${windowDays} días, corte ${cutoff.toISOString()}).`,
      );
    } else {
      this.logger.debug(`Auto-cierre de tickets: nada que cerrar (ventana ${windowDays} días).`);
    }

    return { windowDays, cutoff, candidates: vencidos.length, closed, orphanResolved };
  }
}

/*
 * ─── DOS DECISIONES, JUSTIFICADAS ──────────────────────────────────────────────
 *
 * 1) SIN AuditLog por ticket auto-cerrado.
 *
 *    No es (solo) por ruido — que también: una corrida que cierre 200 tickets
 *    escribiría 200 filas para un evento que no es una decisión de nadie. Es que
 *    NO SE PUEDE escribir sin mentir: `AuditLog.actorId` es NOT NULL y tiene FK a
 *    `User` (ver schema.prisma), y este cierre no tiene actor humano. Habría que
 *    inventar uno —un "usuario sistema" ficticio, o colar el id de un admin que
 *    no hizo nada— y AuditLog es, por definición, "el registro de cada acción
 *    ADMINISTRATIVA sensible": meter ahí acciones del sistema con un actor falso
 *    envenena justo el registro que sirve para pedir cuentas.
 *
 *    La trazabilidad no se pierde: la propia fila la lleva. `closedAt` dice
 *    cuándo y `closedById = null` dice "lo cerró el sistema", que es exactamente
 *    el discriminante frente a un cierre de staff (su id) o de usuario (el suyo).
 *    Y por corrida queda el log de resumen de arriba.
 *
 * 2) SIN notificación al usuario en el auto-cierre.
 *
 *    Ya se le avisó en T7 (R4, `SEND_TICKET_RESOLVED`), y ese aviso incluía la
 *    ventana: "puedes reabrirlo respondiendo durante N días". El auto-cierre es
 *    el vencimiento de ese plazo del que ya se le informó — no información nueva.
 *
 *    Además no habría NADA que hacer con el aviso: pasada la ventana no se puede
 *    reabrir, y la única salida (abrir un ticket nuevo) ya se la ofrece la propia
 *    pantalla del hilo cerrado (R6). Un correo de "hemos cerrado tu ticket" para
 *    algo que el usuario probablemente dio por zanjado hace dos semanas es ruido
 *    que erosiona la atención que sí queremos cuando escribimos de verdad.
 */
