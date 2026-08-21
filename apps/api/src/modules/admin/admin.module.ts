import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_INDEXING,
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
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // Puerta ráfaga 2 — el marcado tras cambiar el schema de una categoría.
    BullModule.registerQueue(retryQueue(QUEUE_REVALIDATION)),
    // BORRADO B3 — retirar del bucket los ficheros del anuncio eliminado.
    BullModule.registerQueue(retryQueue(QUEUE_MEDIA_CLEANUP)),
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
  ],
  controllers: [AdminController, AdminBillingController],
  providers: [AdminService, AdminBillingService],
  exports: [AdminService],
})
export class AdminModule {}
