import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { AdminSponsoredAdsController } from './admin-sponsored-ads.controller';
import { SponsoredAdsService } from './sponsored-ads.service';

@Module({
  imports: [AuditLogModule, CategoryTreeModule],
  controllers: [AdminSponsoredAdsController],
  providers: [SponsoredAdsService],
  exports: [SponsoredAdsService],
})
export class SponsoredAdsModule {}
