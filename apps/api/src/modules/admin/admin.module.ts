import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_INDEXING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ACCOUNT_CLEANUP,
  QUEUE_BILLING,
  QUEUE_MEDIA_CLEANUP,
  QUEUE_REVALIDATION,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SearchModule } from '../search/search.module';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
// FICHA F1 — las señales de moderación de la ficha salen de las MISMAS reglas
// que deciden si un anuncio va a la cola. `ModerationModule` ya exporta las dos
// piezas y no importa a `AdminModule`: no hay ciclo.
import { ModerationModule } from '../moderation/moderation.module';
import { ListingEditValidationModule } from '../listings/listing-edit-validation.module';
import { ListingImagesModule } from '../listings/listing-images.module';
import { AccountArchiveModule } from '../account-archive/account-archive.module';
import { ListingPauseModule } from '../listing-pause/listing-pause.module';
import { DataExportModule } from '../data-export/data-export.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { InstanceInfoService } from './instance-info.service';
import { AccountCleanupProcessor } from './account-cleanup.processor';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { AccountModerationNotificationsModule } from '../account-moderation-notifications/account-moderation-notifications.module';
import { ListingLifecycleNotificationsModule } from '../listing-lifecycle-notifications/listing-lifecycle-notifications.module';
import { ListingExpiryModule } from '../expiration/listing-expiry.module';

@Module({
  imports: [
    // AJUSTES RÁFAGA A — el lector del plazo de caducidad (`listingExpiryDays`). Módulo HOJA:
    // sólo depende de Prisma, así que importarlo no abre ningún ciclo.
    ListingExpiryModule,
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // N5 — `AdminBillingService` avisa por correo del débito de saldo. Se registra
    // AQUÍ aunque `AccountModerationNotificationsModule` ya use la misma cola:
    // `@nestjs/bullmq` crea una instancia productora POR MÓDULO, así que el
    // registro de otro módulo no llega a este inyector (ver `queue.constants.ts`).
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
    // Puerta ráfaga 2 — el marcado tras cambiar el schema de una categoría.
    BullModule.registerQueue(retryQueue(QUEUE_REVALIDATION)),
    // BORRADO B3 — retirar del bucket los ficheros del anuncio eliminado.
    BullModule.registerQueue(
      retryQueue(QUEUE_MEDIA_CLEANUP),
      // C5 — la cancelación inmediata en la pasarela viaja por la cola de
      // facturación, la misma que usa el archivado de C2.
      retryQueue(QUEUE_BILLING),
      // C5 — un trabajo por anuncio de la cuenta vaciada.
      retryQueue(QUEUE_ACCOUNT_CLEANUP),
    ),
    MeilisearchModule,
    AuditLogModule,
    SearchModule,
    CategoryTreeModule,
    ListingGateModule,
    ModerationModule,
    // P3a — las reglas de los campos, las MISMAS que usa el camino del dueño.
    // Módulo neutral y ligero a propósito: `AdminModule` no importa
    // `ListingsModule`, y hacerlo arrastraría medio dominio.
    ListingEditValidationModule,
    ListingImagesModule,
    AccountArchiveModule,
    // RESIDUO BANNED — banear saca los anuncios del escaparate con el MISMO gesto
    // que el archivado. Módulo compartido, no una segunda copia dentro de aquí.
    ListingPauseModule,
    // BORRADO DE CUENTAS C6 — la exportación de datos de cualquier usuario (ADMIN).
    DataExportModule,
    // NOTIFICACIONES N2 — las decisiones sobre la cuenta ya no son mudas. Módulo
    // compartido con `AccountArchiveModule`, no una segunda copia dentro de aquí.
    AccountModerationNotificationsModule,
    // N3 — editar y eliminar un anuncio desde el backoffice avisan a su dueño.
    ListingLifecycleNotificationsModule,
  ],
  // B1 — `AdminStatsController` NO necesita importar `ListingsModule`: lo único que
  // comparte con él son funciones PURAS (`computeCtr`, `ratioWithMinSample`), que se
  // importan como cualquier utilidad y no arrastran DI ni medio dominio detrás.
  controllers: [AdminController, AdminBillingController, AdminStatsController],
  providers: [
    AdminService,
    InstanceInfoService,
    AdminBillingService,
    AdminStatsService,
    AccountCleanupProcessor,
  ],
  exports: [AdminService],
})
export class AdminModule {}
