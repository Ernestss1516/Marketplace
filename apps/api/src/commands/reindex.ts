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
 * Uses its own minimal NestJS module — Postgres y Meilisearch, NADA MÁS: ni
 * Redis, ni BullMQ, ni el controlador de búsqueda — so that all connections
 * close cleanly and the process exits with code 0.
 *
 * ── POR QUÉ IMPORTA `SearchCoreModule` Y NO `SearchModule` ──────────────────
 *
 * Ésta es la línea que hace que el comando termine, y la historia de por qué
 * hizo falta vive entera en `modules/search/search-core.module.ts`. En corto:
 * `SearchModule` declara el `SearchController`, Nest instancia un controlador
 * aunque nadie lo use, y con él venían patrocinados, valoraciones e
 * impresiones — o sea Redis y una cola de BullMQ.
 *
 * Ese arrastre rompió este comando dos veces. La primera (H6.6) lo dejó sin
 * arrancar y se parcheó importando `RedisModule` + `R2Module` aquí. La segunda
 * (N4a, `bcf4064`) metió una `Queue` de BullMQ en la cadena, que abre **su
 * propia** conexión ioredis: la que aquel `RedisService.client.quit()` no
 * podía cerrar porque no era suya. Medido el 2026-09-03: el proceso seguía
 * vivo con **517 MB y 2 conexiones a Redis** dos minutos después de imprimir
 * «Reindex complete».
 *
 * Con el núcleo aislado no hay nada que cerrar a mano: este contexto **no abre
 * ninguna conexión a Redis**, así que los dos parches (los módulos de más y el
 * `quit()`) sobran y se han quitado. Barrera:
 * `test/comandos-standalone.e2e-spec.ts`.
 * ---------------------------------------------------------------------------
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import configuration from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SearchCoreModule } from '../modules/search/search-core.module';
import { SearchService, INDEX_INCLUDE } from '../modules/search/search.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    SearchCoreModule,
  ],
})
export class ReindexModule {}

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

  logger.log('Clearing existing index (removes orphaned documents)…');
  await search.clearAll();
  logger.log('Index cleared. Starting full reindex of ACTIVE listings…');

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

  // EL `RedisService.client.quit()` QUE HABÍA AQUÍ SE HA QUITADO, y no por limpieza: es que
  // ya no hay nada que cerrar. Este contexto no importa `RedisModule`, así que no existe
  // ningún cliente ioredis que apagar (ver la cabecera). Dejarlo habría sido peor que
  // inútil — un `app.get(RedisService)` sobre un proveedor que no está en el contexto
  // lanza, y el comando moriría justo después de haber hecho bien su trabajo.
  //
  // Y sobre todo: aquel `quit()` **nunca fue la solución**. Cerraba la conexión de
  // `RedisService` mientras la que colgaba el proceso era la de la `Queue` de BullMQ, que
  // es otra. Un parche que apunta a la conexión equivocada se lee como si funcionara.

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
