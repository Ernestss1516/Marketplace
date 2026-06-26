import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_BILLING, QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingProcessor } from './billing.processor';
import { EntitlementService } from './entitlement.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_BILLING },
      // BillingService enqueues indexing jobs to update boostScore and sortDate.
      { name: QUEUE_INDEXING },
    ),
  ],
  controllers: [BillingController, WebhooksController],
  providers: [BillingService, EntitlementService, BillingProcessor, StripeWebhookGuard],
  exports: [BillingService, EntitlementService],
})
export class BillingModule {}
