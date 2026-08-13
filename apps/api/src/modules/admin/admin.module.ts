import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, QUEUE_REVALIDATION, retryQueue } from '../../infra/queue/queue.constants';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SearchModule } from '../search/search.module';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // Puerta ráfaga 2 — el marcado tras cambiar el schema de una categoría.
    BullModule.registerQueue(retryQueue(QUEUE_REVALIDATION)),
    MeilisearchModule,
    AuditLogModule,
    SearchModule,
    CategoryTreeModule,
    ListingGateModule,
  ],
  controllers: [AdminController, AdminBillingController],
  providers: [AdminService, AdminBillingService],
  exports: [AdminService],
})
export class AdminModule {}
