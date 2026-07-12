import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BillingModule } from '../billing/billing.module';
import { CouponsController } from './coupons.controller';
import { AdminCouponsController } from './admin-coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // BillingService.grantFeaturedListingTx() — cupón FEATURED (H8 Bloque D fase 3).
    BillingModule,
    AuditLogModule,
  ],
  controllers: [CouponsController, AdminCouponsController],
  providers: [CouponsService],
})
export class CouponsModule {}
