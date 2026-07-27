import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INVOICING, retryQueue } from '../../infra/queue/queue.constants';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { INVOICING_PROVIDER, InvoicingProvider } from './invoicing.types';
import { StubInvoicingProvider } from './providers/stub-invoicing.provider';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { InvoiceProcessor } from './invoice.processor';
import { InvoicingScheduleService } from './invoicing-schedule.service';
import { AdminInvoicingController } from './admin-invoicing.controller';
import { AdminInvoicingService } from './admin-invoicing.service';

/**
 * InvoicingModule — cablea el puerto INVOICING_PROVIDER (RF.13).
 *
 * Selección por config (`invoicing.provider`, env INVOICING_PROVIDER):
 *   - "stub" (por defecto): StubInvoicingProvider — NO emite facturas válidas.
 *
 * CÓMO CONECTAR EL PROVEEDOR REAL (cuando Ernest lo elija):
 *   1. Añadir la implementación (p. ej. HoldedInvoicingProvider) en providers/.
 *   2. Añadir su valor a INVOICING_PROVIDER en env.validation (Joi .valid(...)) y
 *      un `case` en el useFactory de abajo que la devuelva.
 *   3. Poner INVOICING_PROVIDER=<nombre> en el .env de producción.
 * El resto del sistema NO cambia: habla solo con el token, nunca con la clase.
 */
@Module({
  imports: [
    // El cron produce a QUEUE_INVOICING; el InvoiceProcessor la consume. Cada
    // módulo que produce/consume registra la cola con retryQueue (ver
    // queue.constants.ts) — attempts:3 + backoff hacen segura la recuperación.
    BullModule.registerQueue(retryQueue(QUEUE_INVOICING)),
    // NotificationsService: aviso in-app a usuarios con facturables sin datos fiscales.
    NotificationsModule,
    // AuditLogService: registrar el cambio del emisor fiscal (dato sensible).
    AuditLogModule,
  ],
  controllers: [InvoicingController, AdminInvoicingController],
  providers: [
    StubInvoicingProvider,
    {
      provide: INVOICING_PROVIDER,
      inject: [ConfigService, StubInvoicingProvider],
      useFactory: (config: ConfigService, stub: StubInvoicingProvider): InvoicingProvider => {
        const provider = config.get<string>('invoicing.provider') ?? 'stub';
        switch (provider) {
          case 'stub':
            return stub;
          default:
            throw new Error(
              `INVOICING_PROVIDER="${provider}" no tiene implementación conectada todavía. ` +
                `Añade su clase en modules/invoicing/providers y un case en InvoicingModule.`,
            );
        }
      },
    },
    InvoicingService,
    InvoiceProcessor,
    InvoicingScheduleService,
    AdminInvoicingService,
  ],
  exports: [INVOICING_PROVIDER, InvoicingService, InvoicingScheduleService],
})
export class InvoicingModule {}
