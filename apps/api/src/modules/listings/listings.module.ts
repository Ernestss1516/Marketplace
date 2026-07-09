import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_INDEXING }),
    BillingModule,
    ModerationModule,
    ListingActivationModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
