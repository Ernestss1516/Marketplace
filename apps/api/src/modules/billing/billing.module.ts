import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_BILLING } from '../../infra/queue/queue.constants';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingProcessor } from './billing.processor';
import { EntitlementService } from './entitlement.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';

@Module({
  imports: [
    // Register the billing queue so BillingService can inject it and
    // BillingProcessor can consume it. The root connection comes from QueueModule.
    BullModule.registerQueue({ name: QUEUE_BILLING }),
  ],
  controllers: [BillingController, WebhooksController],
  providers: [BillingService, EntitlementService, BillingProcessor, StripeWebhookGuard],
  exports: [EntitlementService],
})
export class BillingModule {}
