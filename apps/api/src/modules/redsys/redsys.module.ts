import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_REDSYS } from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { RedsysController } from './redsys.controller';
import { RedsysService } from './redsys.service';
import { RedsysProcessor } from './redsys.processor';
import { RedsysWebhookGuard } from './guards/redsys-webhook.guard';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_REDSYS }),
    // Import BillingModule to get EntitlementService (used by RedsysService for
    // featured-pay validation: isFeaturedActive check before generating the form).
    BillingModule,
    // CampaignsService.getActiveCreditBonusCampaign() — bonus de campaña en checkout (H8 Bloque D).
    CampaignsModule,
  ],
  controllers: [RedsysController],
  providers: [RedsysService, RedsysProcessor, RedsysWebhookGuard],
})
export class RedsysModule {}
