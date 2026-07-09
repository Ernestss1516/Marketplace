import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListingActivationService } from './listing-activation.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_INDEXING })],
  providers: [ListingActivationService],
  exports: [ListingActivationService],
})
export class ListingActivationModule {}
