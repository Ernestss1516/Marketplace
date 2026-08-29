import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_DATA_EXPORT,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DataExportCollector } from './data-export.collector';
import { DataExportController } from './data-export.controller';
import { DataExportExpirationService } from './data-export-expiration.service';
import { DataExportProcessor } from './data-export.processor';
import { DataExportService } from './data-export.service';

/**
 * BORRADO DE CUENTAS C6 — módulo propio, y por la misma razón que
 * `AccountArchiveModule` en C2: el servicio tiene **dos llamantes que no se
 * conocen**, `UsersModule` (el usuario, desde `/perfil`) y `AdminModule` (el
 * staff, de cualquiera). No puede vivir dentro de ninguno de los dos.
 *
 * `R2Service` no se importa: `R2Module` es `@Global`.
 */
@Module({
  imports: [
    AuditLogModule,
    // A1 — el aviso de «tu ZIP está listo» pasa por el servicio tipado, no por
    // `prisma.notification.create()`. Ver `data-export.service.ts`.
    NotificationsModule,
    BullModule.registerQueue(
      retryQueue(QUEUE_DATA_EXPORT),
      // N5 — el correo del ZIP listo, que caduca.
      retryQueue(QUEUE_NOTIFICATIONS),
    ),
  ],
  controllers: [DataExportController],
  providers: [
    DataExportService,
    DataExportCollector,
    DataExportProcessor,
    DataExportExpirationService,
  ],
  exports: [DataExportService, DataExportExpirationService],
})
export class DataExportModule {}
