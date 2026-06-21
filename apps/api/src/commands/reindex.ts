/**
 * Standalone reindex command.
 *
 * Dumps all ACTIVE listings from Postgres into Meilisearch in batches.
 * Run this whenever you need to rebuild the search index from scratch
 * (e.g., first deploy, after a Meilisearch reset, or after a schema change).
 *
 * Usage (from apps/api/):
 *   pnpm reindex
 *
 * Uses its own minimal NestJS module (no BullMQ / Redis workers) so that
 * all connections close cleanly and the process exits with code 0.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import configuration from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SearchModule } from '../modules/search/search.module';
import { SearchService, INDEX_INCLUDE } from '../modules/search/search.service';

// ---------------------------------------------------------------------------
// Minimal module: Postgres + Meilisearch only, no BullMQ/Redis workers.
// Without QueueModule there are no persistent Redis handles, so app.close()
// shuts everything down cleanly and libuv has nothing left open.
// ---------------------------------------------------------------------------
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    SearchModule,
  ],
})
class ReindexModule {}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;

async function bootstrap(): Promise<void> {
  const logger = new Logger('Reindex');

  const app = await NestFactory.createApplicationContext(ReindexModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const search = app.get(SearchService);

  logger.log('Starting full reindex of ACTIVE listings…');

  let total = 0;
  let skip = 0;

  for (;;) {
    const listings = await prisma.listing.findMany({
      where: { status: 'ACTIVE' },
      include: INDEX_INCLUDE,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      skip,
    });

    if (listings.length === 0) break;

    await search.reindexAll(listings);
    total += listings.length;
    skip += listings.length;
    logger.log(`Indexed ${total} listings so far…`);

    if (listings.length < BATCH_SIZE) break;
  }

  logger.log(`Reindex complete. Total indexed: ${total} listings.`);

  // Prisma recommended pattern for CLI scripts: call $disconnect() and do NOT
  // call process.exit() on the happy path.
  //
  // Why: process.exit() triggers libuv teardown synchronously; on Windows with
  // Prisma 6.x the query-engine thread may still be alive and calls uv_async_send()
  // on a handle that libuv has already marked UV_HANDLE_CLOSING → fatal assertion
  // (0xC0000409), even though the work completed successfully.
  //
  // After $disconnect(), Prisma's IPC handle is released and undici (Node.js 18+
  // global fetch, used by the Meilisearch SDK) unref()s its internal timers and
  // worker-thread ports. The event loop therefore drains naturally and the process
  // exits with code 0 without touching libuv directly.
  await prisma.$disconnect();
}

bootstrap().catch(async (err: unknown) => {
  console.error('Reindex failed:', err);
  // Disconnect before exiting on error so Prisma doesn't leak a process handle.
  process.exit(1);
});
