import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_IMAGE } from '../../infra/queue/queue.constants';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_IMAGE })],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
