import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ListingsModule } from '../listings/listings.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { BillingModule } from '../billing/billing.module';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';

@Module({
  imports: [ListingsModule, ReviewsModule, BillingModule, MediaCleanupModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
