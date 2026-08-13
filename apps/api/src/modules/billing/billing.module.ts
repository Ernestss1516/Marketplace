import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_BILLING, QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingProcessor } from './billing.processor';
import { EntitlementService } from './entitlement.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';

@Module({
  imports: [
    BullModule.registerQueue(
      retryQueue(QUEUE_BILLING),
      // BillingService enqueues indexing jobs to update boostScore and sortDate.
      retryQueue(QUEUE_INDEXING),
    ),
    // CampaignsService.getActiveActionDiscount() — descuento en bump/destacar (H8 Bloque D fase 2).
    CampaignsModule,
    // PUERTA — por `ProStatusService`: «¿es Pro?» vive en un módulo HOJA para que
    // la puerta pueda preguntarlo sin importar BillingModule (sería un ciclo).
    // La dirección es la segura: Billing → puerta, nunca al revés.
    ListingGateModule,
  ],
  controllers: [BillingController, WebhooksController],
  providers: [BillingService, EntitlementService, BillingProcessor, StripeWebhookGuard],
  exports: [BillingService, EntitlementService],
})
export class BillingModule {}
