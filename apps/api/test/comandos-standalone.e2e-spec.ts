import { INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ReviewsModule } from 'src/modules/reviews/reviews.module';
import { parseRedisConnection } from 'src/infra/redis/redis-connection';
import { ReindexModule } from 'src/commands/reindex';
import { GeocodingBackfillModule } from 'src/commands/geocode-backfill';
import { RedisService } from 'src/infra/redis/redis.service';
import { SearchService } from 'src/modules/search/search.service';
import { GeocodingService } from 'src/modules/geocoding/geocoding.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import {
  QUEUE_ACCOUNT_CLEANUP,
  QUEUE_ALERT_MATCHING,
  QUEUE_BILLING,
  QUEUE_BUMP_AUTO,
  QUEUE_DATA_EXPORT,
  QUEUE_IMAGE,
  QUEUE_INDEXING,
  QUEUE_INVOICING,
  QUEUE_MEDIA_CLEANUP,
  QUEUE_MESSAGE_DIGEST,
  QUEUE_NOTIFICATIONS,
  QUEUE_REDSYS,
  QUEUE_REVALIDATION,
} from 'src/infra/queue/queue.constants';

/**
 * LOS COMANDOS DE ADMINISTRACIÓN NO ARRASTRAN INFRAESTRUCTURA QUE NO USAN.
 *
 * ── POR QUÉ ESTA BARRERA EXISTE ─────────────────────────────────────────────────────────
 *
 * El mismo defecto ha roto estos comandos TRES veces, cada una al colgar un módulo nuevo de
 * `SearchModule` — y las tres veces el síntoma apareció lejos de la causa:
 *
 *  · **H6.6** (patrocinados) → `pnpm reindex` dejó de ARRANCAR.
 *  · **N4a** (`bcf4064`, una cola en `ReviewsModule`) → `pnpm reindex` dejó de TERMINAR:
 *    medido, 517 MB y 2 conexiones a Redis dos minutos después de acabar su trabajo.
 *  · **A1** (impresiones) → `pnpm geocode-backfill` dejó de ARRANCAR, y nadie lo notó
 *    porque es un comando que se ejecuta muy de vez en cuando.
 *
 * Nadie de los tres hizo nada mal: añadieron un módulo a `SearchModule`, que es donde va. Lo
 * que faltaba era **poder afirmar** que los comandos no se lo llevan puesto. Eso es esto.
 *
 * ── SE ARRANCA EL CONTEXTO DE VERDAD, NO SE LEEN LOS IMPORTS ───────────────────────────
 *
 * Comprobar el `@Module({ imports })` a ojo no habría cazado ninguno de los tres: el
 * arrastre no está en el import, está tres saltos más abajo, y encima llega por un
 * CONTROLADOR que el script no usa. La única forma honesta es levantar el contexto y
 * preguntarle qué tiene dentro.
 *
 * De regalo, esto prueba lo que a dos de los tres incidentes les faltó: **que el comando
 * arranca**. Un `createApplicationContext` que resuelve es exactamente lo que H6.6 y A1
 * rompieron.
 */
/**
 * EL CONTROL POSITIVO: un contexto que SÍ trae cola.
 *
 * ── Por qué lleva su propio `forRoot`, y por qué es un módulo DECORADO ──────────────
 *
 * `ReviewsModule` levantado a pelo se queda sin configuración de conexión, y BullMQ cae
 * a su defecto: `localhost:6379`, **db 0** — la Redis de DESARROLLO. Medido en esta
 * ráfaga con `CLIENT LIST`: la conexión de este contexto aparecía en `db=0` haciendo
 * `hset`, que es BullMQ escribiendo `bull:<cola>:meta` al inicializarse. O sea que la
 * batería de test escribía en la Redis de quien la ejecuta — el mismo pecado que la
 * barrera de aislamiento de `Setting` persigue en Postgres, y por la misma razón.
 *
 * Con el `forRoot` la cola va a la db de test, y además el contexto se parece MÁS a
 * producción, donde `ReviewsModule` siempre cuelga de `AppModule` (que trae
 * `QueueModule`, que trae el `forRoot`). El contexto pelado era el artificio.
 *
 * Va como clase con `@Module()` —la forma normal— y no como un objeto `DynamicModule`
 * suelto, para que los ganchos de cierre de `@nestjs/bullmq`
 * (`queue.onApplicationShutdown → queue.close()`) corran por la vía de siempre.
 */
@Module({
  imports: [
    BullModule.forRoot({ connection: parseRedisConnection(process.env.REDIS_URL as string) }),
    ReviewsModule,
  ],
})
class ContextoConCola {}

describe('Comandos standalone — aislados de Redis y de BullMQ (e2e)', () => {
  /** Las trece colas del proyecto. Si aparece una catorceava, este test no la conocerá:
   *  por eso hay más abajo una comprobación que no depende de la lista. */
  const TODAS_LAS_COLAS = [
    QUEUE_IMAGE, QUEUE_INDEXING, QUEUE_NOTIFICATIONS, QUEUE_BILLING, QUEUE_REDSYS,
    QUEUE_ALERT_MATCHING, QUEUE_INVOICING, QUEUE_BUMP_AUTO, QUEUE_REVALIDATION,
    QUEUE_MEDIA_CLEANUP, QUEUE_ACCOUNT_CLEANUP, QUEUE_DATA_EXPORT, QUEUE_MESSAGE_DIGEST,
  ];

  /** ¿Está este proveedor dentro del contexto? `strict: false` mira el árbol entero. */
  function tiene(app: INestApplicationContext, token: unknown): boolean {
    try {
      app.get(token as never, { strict: false });
      return true;
    } catch {
      return false;
    }
  }

  describe.each([
    ['ReindexModule (pnpm reindex)', ReindexModule],
    ['GeocodingBackfillModule (pnpm geocode-backfill)', GeocodingBackfillModule],
  ])('%s', (_nombre, Modulo) => {
    let app: INestApplicationContext;

    beforeAll(async () => {
      // ARRANCA DE VERDAD. Es media barrera por sí solo: H6.6 y A1 se manifestaron
      // exactamente aquí, con «Nest can't resolve dependencies of …».
      app = await NestFactory.createApplicationContext(Modulo, { logger: false });
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    });

    it('no registra NINGUNA de las trece colas de BullMQ', () => {
      const registradas = TODAS_LAS_COLAS.filter((cola) => tiene(app, getQueueToken(cola)));
      // Cada `Queue` abre su PROPIA conexión ioredis, distinta de la de `RedisService` —
      // que es justo por lo que el `quit()` del parche anterior no la cerraba nunca.
      expect(registradas).toEqual([]);
    });

    it('no tiene RedisService: el comando no abre ni una conexión a Redis', () => {
      expect(tiene(app, RedisService)).toBe(false);
    });

    it('pero SÍ tiene lo que necesita para hacer su trabajo', () => {
      // La otra mitad, y sin ella esta suite se «aprueba» vaciando los módulos: quitar
      // dependencias hasta que no quede nada también deja cero colas.
      expect(tiene(app, PrismaService)).toBe(true);
      expect(tiene(app, SearchService)).toBe(true);
    });
  });

  it('el backfill de geocodificación conserva ADEMÁS su geocodificador', async () => {
    const app = await NestFactory.createApplicationContext(GeocodingBackfillModule, {
      logger: false,
    });
    try {
      expect(app.get(GeocodingService, { strict: false })).toBeDefined();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('la propia comprobación distingue un contexto que SÍ trae cola (red del test)', async () => {
    // Sin esto, un `tiene()` que devolviera siempre `false` —por un token mal formado, por
    // ejemplo— haría pasar la barrera entera sin mirar nada. Se le enseña un positivo: el
    // módulo de la búsqueda COMPLETA, que es el que sí arrastra la cola de notificaciones,
    // y que es exactamente lo que los comandos ya no importan.
    //
    // Se comprueba sobre `ReviewsModule`, que es quien la registra, para no tener que
    // levantar toda la cadena del controlador.
    const app = await NestFactory.createApplicationContext(ContextoConCola, { logger: false });
    try {
      expect(tiene(app, getQueueToken(QUEUE_NOTIFICATIONS))).toBe(true);

      // ── NO SE CIERRA UNA CONEXIÓN QUE TODAVÍA SE ESTÁ ABRIENDO ────────────────
      //
      // Este es el único contexto de la suite que trae una `Queue`, y es el que
      // ponía la suite en rojo en CI con «Unhandled error. (Error: Connection is
      // closed.)» — 2697/2697 tests en verde y la suite marcada como fallida.
      //
      // El mecanismo, medido (ver docs/auditoria-deuda-test-ci.md §7): una `Queue`
      // recién creada abre su conexión en SEGUNDO PLANO, y su constructor deja
      // enganchado `this.initializing.catch(err => this.emit('error', err))`
      // (bullmq/redis-connection.js:87 — el marco exacto del rastro de CI). Si el
      // contexto se cierra mientras ese `init()` tiene un comando en vuelo, ioredis
      // rompe la promesa con «Connection is closed.» y BullMQ la emite como evento
      // `'error'` sobre una `Queue` que nadie escucha: un `EventEmitter` sin
      // oyente de `'error'` LANZA, y Jest lo cuenta como fallo de la suite entera.
      //
      // Medido aquí mismo: en esta máquina, ociosa, `waitUntilReady()` todavía
      // tardaba 1-3 ms en 4 de 5 corridas. Esa es la ventana; en un runner cargado
      // se ensancha hasta que el cierre cae dentro. Reproducido de forma
      // determinista retrasando los bytes hacia Redis con un proxy TCP: sin esta
      // línea, rojo con la firma exacta; con ella, verde.
      //
      // Esperar aquí no esconde nada — el `init()` termina y ya no hay promesa que
      // romper. Silenciarlo con un `on('error')` de adorno sí habría sido taparlo.
      const cola = app.get<Queue>(getQueueToken(QUEUE_NOTIFICATIONS) as never, { strict: false });
      await cola.waitUntilReady();
    } finally {
      await app.close();
    }
  }, 60_000);
});
