import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { ExpirationService } from './expiration.service';
import { EntitlementExpirationService } from './entitlement-expiration.service';

@Module({
  imports: [BullModule.registerQueue(retryQueue(QUEUE_INDEXING))],
  providers: [ExpirationService, EntitlementExpirationService],
  exports: [ExpirationService, EntitlementExpirationService],
})
export class ExpirationModule {}
