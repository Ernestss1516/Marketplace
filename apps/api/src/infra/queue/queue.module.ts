import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_IMAGE, QUEUE_INDEXING, QUEUE_NOTIFICATIONS } from './queue.constants';
import { ImageProcessor } from './processors/image.processor';
import { IndexingProcessor } from './processors/indexing.processor';
import { NotificationProcessor } from './processors/notification.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        // Parse the REDIS_URL into host/port to avoid ioredis version type conflicts
        const url = new URL(config.getOrThrow<string>('redis.url'));
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUE_IMAGE },
      { name: QUEUE_INDEXING },
      { name: QUEUE_NOTIFICATIONS },
    ),
  ],
  providers: [ImageProcessor, IndexingProcessor, NotificationProcessor],
  exports: [BullModule],
})
export class QueueModule {}
