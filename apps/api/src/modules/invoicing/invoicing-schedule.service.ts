import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_INVOICING } from '../../infra/queue/queue.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { hasCompleteFiscalData } from './invoicing.types';
import { INVOICING_JOB } from './invoice.processor';
import { Periodicity, periodRange, periodsToProcess, previousClosedPeriodKey } from './period';

/** Setting: periodicidad de la facturación automática. Default y confirmado por el asesor: QUARTERLY. */
const PERIODICITY_SETTING_KEY = 'fiscalInvoicingPeriodicity';
/** Setting (marca): último periodKey ya despachado por el cron. Da idempotencia + recuperación. */
const LAST_PERIOD_SETTING_KEY = 'fiscalInvoicingLastPeriod';

/**
 * Cron de facturación automática (RF.13 R4) — OPCIÓN A: se despierta A DIARIO y
 * decide si toca emitir según el Setting de periodicidad. No reimplementa la
 * emisión: detecta el/los periodo(s) cerrado(s) sin facturar, y para cada usuario
 * elegible ENCOLA un job en QUEUE_INVOICING (el InvoiceProcessor emite, reutilizando
 * InvoicingService.emitForPeriod). El trabajo pesado (N usuarios × PDF/proveedor)
 * va en cola, NUNCA inline en el cron.
 *
 * RECUPERACIÓN: en vez de "¿hoy es el día 1?", pregunta "¿hay periodos cerrados sin
 * facturar?" (marca `fiscalInvoicingLastPeriod` vs. periodo cerrado más reciente).
 * Si el servidor estuvo caído en uno o varios cierres, al arrancar los detecta y
 * emite todos. La idempotencia (idempotencyKey @unique + transactionId @unique)
 * hace seguro re-ejecutar.
 */
@Injectable()
export class InvoicingScheduleService {
  private readonly logger = new Logger(InvoicingScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_INVOICING) private readonly queue: Queue,
    private readonly notifications: NotificationsService,
  ) {}

  // Diario a las 04:00. El @Cron es fino: delega en el método público testeable
  // (recibe la fecha, nunca new Date() dentro de la lógica) — molde de
  // entitlement-expiration.service.ts.
  @Cron('0 4 * * *')
  async handleCron(): Promise<void> {
    await this.runScheduledInvoicing(new Date());
  }

  /**
   * Punto de entrada público (testeable con una fecha inyectada). Detecta los
   * periodos cerrados pendientes y despacha la emisión de cada uno. Devuelve un
   * resumen para observabilidad/tests.
   */
  async runScheduledInvoicing(today: Date) {
    const periodicity = await this.getPeriodicity();
    const closedPeriod = previousClosedPeriodKey(today, periodicity);
    const lastProcessed = await this.getLastProcessedPeriod();
    const pending = periodsToProcess(lastProcessed, closedPeriod, periodicity);

    const dispatched = [];
    for (const periodKey of pending) {
      const r = await this.dispatchPeriod(periodKey);
      await this.setLastProcessedPeriod(periodKey);
      dispatched.push(r);
    }

    if (pending.length === 0) {
      this.logger.debug(`Facturación automática: nada que emitir (último=${lastProcessed}, cerrado=${closedPeriod}).`);
    }
    return { periodicity, closedPeriod, lastProcessed, pending, dispatched };
  }

  /** Selecciona usuarios con facturables del periodo y reparte: encola emisión a
   * los elegibles; notifica a los que tienen movimientos pero les faltan datos. */
  private async dispatchPeriod(periodKey: string) {
    const { start, end } = periodRange(periodKey);

    const rows = await this.prisma.transaction.findMany({
      where: {
        status: 'SUCCEEDED',
        gateway: { in: ['STRIPE', 'REDSYS'] },
        invoiceLine: { is: null },
        createdAt: { gte: start, lt: end },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const userIds = rows.map((r) => r.userId);
    if (userIds.length === 0) {
      return { periodKey, eligible: [] as string[], missingFiscalData: [] as string[] };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        fiscalTaxId: true,
        fiscalName: true,
        fiscalAddress: true,
        fiscalCity: true,
        fiscalPostalCode: true,
        fiscalProvince: true,
      },
    });

    const eligible: string[] = [];
    const missingFiscalData: string[] = [];
    for (const u of users) {
      (hasCompleteFiscalData(u) ? eligible : missingFiscalData).push(u.id);
    }

    // Elegibles → cola (trabajo pesado). jobId estable = dedup de BullMQ si el
    // cron se dispara dos veces antes de actualizar la marca (guard extra; el
    // guard fuerte es idempotencyKey @unique en la emisión).
    for (const userId of eligible) {
      await this.queue.add(
        INVOICING_JOB.EMIT_PERIOD,
        { userId, periodKey },
        { jobId: `inv-emit-${periodKey}-${userId}` },
      );
    }

    // Sin datos fiscales pero CON facturables → aviso in-app (ligero, inline). Sus
    // Transactions siguen facturables para emisión manual (R3) dentro de la ventana.
    // BORDE (decisión de negocio, marcar no resolver): si la ventana cierra sin que
    // completen datos, esos movimientos quedan sin facturar por el usuario; qué
    // obligación tiene entonces la plataforma lo decide Ernest con su asesor.
    for (const userId of missingFiscalData) {
      const facturableCount = await this.prisma.transaction.count({
        where: {
          userId,
          status: 'SUCCEEDED',
          gateway: { in: ['STRIPE', 'REDSYS'] },
          invoiceLine: { is: null },
          createdAt: { gte: start, lt: end },
        },
      });
      await this.notifications.createNotification(userId, 'INVOICING_PENDING_FISCAL_DATA', {
        periodKey,
        facturableCount,
      });
    }

    this.logger.log(
      `Facturación automática ${periodKey}: ${eligible.length} elegibles encolados, ` +
        `${missingFiscalData.length} avisados (sin datos fiscales).`,
    );
    return { periodKey, eligible, missingFiscalData };
  }

  private async getPeriodicity(): Promise<Periodicity> {
    const s = await this.prisma.setting.findUnique({ where: { key: PERIODICITY_SETTING_KEY } });
    return String(s?.value ?? 'QUARTERLY') === 'MONTHLY' ? 'MONTHLY' : 'QUARTERLY';
  }

  private async getLastProcessedPeriod(): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key: LAST_PERIOD_SETTING_KEY } });
    return s ? String(s.value) : null;
  }

  private async setLastProcessedPeriod(periodKey: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: LAST_PERIOD_SETTING_KEY },
      update: { value: periodKey },
      create: { key: LAST_PERIOD_SETTING_KEY, value: periodKey },
    });
  }
}
