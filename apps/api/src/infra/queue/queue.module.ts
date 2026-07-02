import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_BILLING, QUEUE_IMAGE, QUEUE_INDEXING, QUEUE_NOTIFICATIONS } from './queue.constants';
import { ImageProcessor } from './processors/image.processor';
import { IndexingProcessor } from './processors/indexing.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { GeocodingModule } from '../../modules/geocoding/geocoding.module';
import { SearchModule } from '../../modules/search/search.module';

// PrismaModule is @Global(), so PrismaService is available without importing PrismaModule here.
// SearchModule and GeocodingModule are imported to provide their services to IndexingProcessor.

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        // Parse REDIS_URL into host/port to avoid ioredis version type conflicts.
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
      {
        name: QUEUE_INDEXING,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
      { name: QUEUE_NOTIFICATIONS },
      {
        name: QUEUE_BILLING,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    ),
    GeocodingModule,
    SearchModule,
  ],
  providers: [ImageProcessor, IndexingProcessor, NotificationProcessor],
  exports: [BullModule],
})
export class QueueModule {}
