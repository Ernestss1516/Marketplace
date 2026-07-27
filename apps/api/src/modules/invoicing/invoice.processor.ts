import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_INVOICING } from '../../infra/queue/queue.constants';
import { InvoicingService } from './invoicing.service';

export const INVOICING_JOB = {
  EMIT_PERIOD: 'emit-period',
} as const;

export interface EmitPeriodJobData {
  userId: string;
  periodKey: string;
}

/**
 * Consumidor de QUEUE_INVOICING (RF.13 R4). Cada job {userId, periodKey} emite la
 * factura automática de ese usuario para ese periodo, reutilizando
 * InvoicingService.emitForPeriod (misma lógica probada de R3: congelar, emitir vía
 * proveedor, PDF a R2, latch ISSUED).
 *
 * Idempotencia (crítica — son documentos fiscales): emitForPeriod usa
 * idempotencyKey=userId:periodKey (@unique) → un job reintentado NO duplica la
 * factura. Si el proveedor/R2 fallan, emitForPeriod hace rollback del DRAFT y
 * este job LANZA → retryQueue lo reintenta (attempts:3, backoff); la 2ª vez emite
 * limpio sin duplicar ni dejar Transactions bloqueadas.
 */
@Processor(QUEUE_INVOICING)
export class InvoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceProcessor.name);

  constructor(private readonly invoicing: InvoicingService) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case INVOICING_JOB.EMIT_PERIOD: {
          const { userId, periodKey } = job.data as EmitPeriodJobData;
          const invoice = await this.invoicing.emitForPeriod(userId, periodKey);
          this.logger.log(
            invoice
              ? `Factura AUTO emitida ${invoice.number} (user ${userId}, ${periodKey})`
              : `Sin factura para user ${userId}, ${periodKey} (sin datos fiscales o sin facturables)`,
          );
          return;
        }
        default:
          throw new Error(`Unknown invoicing job: ${job.name}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err; // que BullMQ reintente (retryQueue)
    }
  }
}
