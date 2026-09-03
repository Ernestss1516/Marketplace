/**
 * Geocoding backfill command.
 *
 * Assigns lat/lng to all listings that have a city but no coordinates, then
 * re-indexes each updated ACTIVE listing in Meilisearch so _geo is populated.
 *
 * Uses cursor-based pagination so already-geocoded listings are skipped on
 * subsequent runs (the WHERE clause excludes latitude IS NOT NULL).
 *
 * Usage (from apps/api/):
 *   pnpm geocode-backfill
 *
 * Nominatim usage policy: max 1 request/second. The 1 000 ms delay between
 * requests is mandatory and must not be removed.
 */

import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import configuration from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SearchCoreModule } from '../modules/search/search-core.module';
import { SearchService, INDEX_INCLUDE } from '../modules/search/search.service';
import { GeocodingModule } from '../modules/geocoding/geocoding.module';
import { GeocodingService, TransientGeocodingError } from '../modules/geocoding/geocoding.service';

// ---------------------------------------------------------------------------
// Minimal module: Postgres + Meilisearch + Geocoding only, no BullMQ/Redis
// workers, so app.close() shuts down cleanly (no dangling libuv handles).
//
// ESO ERA MENTIRA HASTA HOY, y este comando estaba ROTO. Importaba
// `SearchModule`, que declara el `SearchController`, y Nest instancia el
// controlador aunque el script sólo use `SearchService`: con él venían
// patrocinados e impresiones, los dos dependientes de `RedisService`. Medido el
// 2026-09-03, `pnpm geocode-backfill` ni arrancaba — moría con «Nest can't
// resolve dependencies of the ImpressionsService». Nadie lo notó porque es un
// comando que se ejecuta muy de vez en cuando.
//
// Es el MISMO defecto que dejaba `pnpm reindex` colgado, sólo que este comando
// nunca recibió el parche que aquél sí recibió, así que se manifestó antes y
// peor. Con `SearchCoreModule` el comentario de arriba vuelve a ser cierto.
// Ver `modules/search/search-core.module.ts`.
// ---------------------------------------------------------------------------
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    SearchCoreModule,
    GeocodingModule,
  ],
})
export class GeocodingBackfillModule {}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
/** 1 000 ms between requests — required by Nominatim's usage policy. */
const DELAY_MS = 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function bootstrap(): Promise<void> {
  const logger = new Logger('GeocodingBackfill');

  const app = await NestFactory.createApplicationContext(GeocodingBackfillModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const search = app.get(SearchService);
  const geocoding = app.get(GeocodingService);

  logger.log('Starting geocoding backfill…');

  let geocoded = 0;
  let notFound = 0;
  let failed = 0;
  let cursor: string | undefined;

  for (;;) {
    const listings = await prisma.listing.findMany({
      where: { latitude: null, city: { not: null } },
      select: { id: true, city: true, province: true, postalCode: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      // Cursor-based pagination: listings we've already processed (geocoded or not)
      // are excluded either by the latitude filter (geocoded) or by cursor position.
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (listings.length === 0) break;

    for (const listing of listings) {
      // geocode() throws TransientGeocodingError for timeout/network/429/5xx —
      // failures worth retrying on a LATER run of this script, not the same
      // pass. Skip this listing (it stays latitude: null, so the WHERE clause
      // picks it up again next run) instead of aborting the whole backfill.
      let coords: Awaited<ReturnType<typeof geocoding.geocode>>;
      try {
        coords = await geocoding.geocode(
          listing.city!,
          listing.province ?? '',
          listing.postalCode ?? undefined,
        );
      } catch (err) {
        if (!(err instanceof TransientGeocodingError)) throw err;
        failed++;
        logger.warn(
          `[${geocoded + notFound + failed}] Transient failure, will retry on a future run: "${listing.city}, ${listing.province}" — ${err.message}`,
        );
        await delay(DELAY_MS);
        continue;
      }

      if (coords) {
        await prisma.listing.update({
          where: { id: listing.id },
          data: { latitude: coords.lat, longitude: coords.lng },
        });

        // Re-index so Meilisearch gets _geo; indexListing handles ACTIVE vs. other.
        const full = await prisma.listing.findUnique({
          where: { id: listing.id },
          include: INDEX_INCLUDE,
        });
        if (full) await search.indexListing(full);

        geocoded++;
        logger.log(
          `[${geocoded + notFound}] OK: "${listing.city}, ${listing.province}" → (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
        );
      } else {
        notFound++;
        logger.warn(
          `[${geocoded + notFound}] No result: "${listing.city}, ${listing.province}"`,
        );
      }

      await delay(DELAY_MS);
    }

    cursor = listings[listings.length - 1].id;
    if (listings.length < BATCH_SIZE) break;
  }

  logger.log(
    `Backfill complete. Geocoded: ${geocoded}, no result: ${notFound}, transient failures (retry next run): ${failed}.`,
  );

  // See reindex.ts for the explanation of why $disconnect() + no process.exit().
  await prisma.$disconnect();
}

bootstrap().catch(async (err: unknown) => {
  console.error('Geocoding backfill failed:', err);
  process.exit(1);
});
