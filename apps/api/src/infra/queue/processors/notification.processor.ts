import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  async process(_job: Job): Promise<void> {
    // TODO: dispatch email / push notifications
  }
}
