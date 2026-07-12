import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { BadWordService } from './bad-word.service';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    AuditLogModule,
    ListingActivationModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService, BadWordService],
  exports: [ModerationService, BadWordService],
})
export class ModerationModule {}
