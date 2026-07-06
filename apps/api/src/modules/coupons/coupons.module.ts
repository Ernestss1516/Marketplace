import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_INDEXING }),
    // BillingService.grantFeaturedListingTx() — cupón FEATURED (H8 Bloque D fase 3).
    BillingModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
})
export class CouponsModule {}
