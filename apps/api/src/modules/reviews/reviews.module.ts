import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';

@Module({
  imports: [
    PrismaModule,
    // N4a — el aviso de «te han valorado», por los dos canales.
    NotificationsModule,
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
