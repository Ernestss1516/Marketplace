import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SearchModule } from '../search/search.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertMatchingService } from './alert-matching.service';

@Module({
  imports: [
    SearchModule,
    NotificationsModule,
    // Re-registered here (same pattern as ListingsModule/ModerationModule for
    // QUEUE_INDEXING) so AlertMatchingService can inject QUEUE_NOTIFICATIONS to
    // enqueue SEND_ALERT_EMAIL. retryQueue() MUST be repeated here — see the
    // comment on retryQueue(): this module's own Queue instance is
    // the one AlertMatchingService.notificationQueue.add() actually uses.
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertMatchingService],
  exports: [AlertsService, AlertMatchingService],
})
export class AlertsModule {}
