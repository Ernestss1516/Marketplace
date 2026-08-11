import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  QUEUE_ALERT_MATCHING,
  QUEUE_BILLING,
  QUEUE_IMAGE,
  QUEUE_INDEXING,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from './queue.constants';
import { ImageProcessor } from './processors/image.processor';
import { IndexingProcessor } from './processors/indexing.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { AlertMatchingProcessor } from './processors/alert-matching.processor';
import { GeocodingModule } from '../../modules/geocoding/geocoding.module';
import { SearchModule } from '../../modules/search/search.module';
import { AlertsModule } from '../../modules/alerts/alerts.module';
import { CategoryTreeModule } from '../../modules/categories/category-tree.module';
import { parseRedisConnection } from '../redis/redis-connection';

// PrismaModule is @Global(), so PrismaService is available without importing PrismaModule here.
// SearchModule and GeocodingModule are imported to provide their services to IndexingProcessor.
// AlertsModule provides AlertMatchingService to AlertMatchingProcessor (B3).

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        // parseRedisConnection resolves the db index from REDIS_URL's path (e.g.
        // redis://localhost:6379/1) — without it BullMQ silently connects to db 0
        // regardless of REDIS_URL, defeating dev/test Redis isolation entirely.
        connection: {
          ...parseRedisConnection(config.getOrThrow<string>('redis.url')),
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      retryQueue(QUEUE_IMAGE),
      retryQueue(QUEUE_INDEXING),
      retryQueue(QUEUE_NOTIFICATIONS),
      retryQueue(QUEUE_BILLING),
      // Dedicated queue, isolated from QUEUE_INDEXING: matching failures must
      // never back up the queue that keeps the search index fresh. Retry is
      // safe because AlertMatchingService is idempotent (AlertMatch @@unique).
      retryQueue(QUEUE_ALERT_MATCHING),
    ),
    GeocodingModule,
    SearchModule,
    AlertsModule,
    // PROFUNDIDAD N — RÁFAGA 2: IndexingProcessor resuelve la subcadena a
    // reindexar (`reindex-category-subtree`) con el único lector de la jerarquía.
    CategoryTreeModule,
  ],
  providers: [ImageProcessor, IndexingProcessor, NotificationProcessor, AlertMatchingProcessor],
  exports: [BullModule],
})
export class QueueModule {}
