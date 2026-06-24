import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_INDEXING }),
    MeilisearchModule,
    AuditLogModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
