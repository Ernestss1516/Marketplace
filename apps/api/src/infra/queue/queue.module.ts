import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  QUEUE_ALERT_MATCHING,
  QUEUE_BILLING,
  QUEUE_IMAGE,
  QUEUE_INDEXING,
  QUEUE_NOTIFICATIONS,
  RETRY_JOB_OPTIONS,
} from './queue.constants';
import { ImageProcessor } from './processors/image.processor';
import { IndexingProcessor } from './processors/indexing.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { AlertMatchingProcessor } from './processors/alert-matching.processor';
import { GeocodingModule } from '../../modules/geocoding/geocoding.module';
import { SearchModule } from '../../modules/search/search.module';
import { AlertsModule } from '../../modules/alerts/alerts.module';

// PrismaModule is @Global(), so PrismaService is available without importing PrismaModule here.
// SearchModule and GeocodingModule are imported to provide their services to IndexingProcessor.
// AlertsModule provides AlertMatchingService to AlertMatchingProcessor (B3).

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
      { name: QUEUE_INDEXING, defaultJobOptions: RETRY_JOB_OPTIONS },
      { name: QUEUE_NOTIFICATIONS, defaultJobOptions: RETRY_JOB_OPTIONS },
      { name: QUEUE_BILLING, defaultJobOptions: RETRY_JOB_OPTIONS },
      // Dedicated queue, isolated from QUEUE_INDEXING: matching failures must
      // never back up the queue that keeps the search index fresh. Retry is
      // safe because AlertMatchingService is idempotent (AlertMatch @@unique).
      { name: QUEUE_ALERT_MATCHING, defaultJobOptions: RETRY_JOB_OPTIONS },
    ),
    GeocodingModule,
    SearchModule,
    AlertsModule,
  ],
  providers: [ImageProcessor, IndexingProcessor, NotificationProcessor, AlertMatchingProcessor],
  exports: [BullModule],
})
export class QueueModule {}
