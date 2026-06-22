import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ExpirationService } from './expiration.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_INDEXING })],
  providers: [ExpirationService],
})
export class ExpirationModule {}
