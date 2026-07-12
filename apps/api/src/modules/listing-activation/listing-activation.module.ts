import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { ListingActivationService } from './listing-activation.service';

@Module({
  imports: [BullModule.registerQueue(retryQueue(QUEUE_INDEXING))],
  providers: [ListingActivationService],
  exports: [ListingActivationService],
})
export class ListingActivationModule {}
