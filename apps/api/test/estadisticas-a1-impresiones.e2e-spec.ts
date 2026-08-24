/**
 * ESTADÍSTICAS A1 — LA CAPTURA DE «VECES LISTADO», contra la infraestructura real.
 *
 * Aquí van las barreras que sólo se pueden demostrar con Redis, Postgres y Meilisearch
 * de verdad: que una búsqueda servida ACABE siendo una fila en `ListingImpressionDaily`,
 * que el drenaje sea atómico e idempotente, y —la que más importa— que las alertas NO
 * cuenten, porque eso depende de dónde vive el contador y no de lo que diga un mock.
 *
 * Las garantías de FORMA (que no se pueda esperar, que no rompa la búsqueda si Redis se
 * cae, cuántas operaciones hace) están en src/modules/impressions/impressions.service.spec.ts.
 *
 * Diseño: docs/diseno-estadisticas.md, parte A.
 */
import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { pollUntil } from './helpers/poll';
import { INDEX_INCLUDE, SearchService } from 'src/modules/search/search.service';
import { ImpressionsService } from 'src/modules/impressions/impressions.service';
import { RedisService } from 'src/infra/redis/redis.service';

/** Palabra propia de esta suite: acota cada búsqueda a SUS anuncios y nada más. */
const MARCA = 'impresionesxyz';
/** Marca del anuncio centinela, que no comparte ninguna búsqueda con los demás. */
const CENTINELA = 'centinelaxyz';

describe('Estadísticas A1 — captura de impresiones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let search: SearchService;
  let impressions: ImpressionsService;
  let redis: Redis;
  let sellerId: string;
  let categoryId: string;
  let categorySlug: string;
  let centinelaId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    search = app.get(SearchService);
    impressions = app.get(ImpressionsService);
    redis = app.get(RedisService).client;

    const categoria = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = categoria.id;
    categorySlug = categoria.slug;

    const seller = await prisma.user.create({
      data: {
        email: 'impresiones@example.com',
        name: 'Impresiones',
        slug: 'impresiones-a1',
        passwordHash: 'x',
        emailVerified: true,
      },
      select: { id: true },
    });
    sellerId = seller.id;

    centinelaId = await crearAnuncio(`${CENTINELA} uno`, 'centinela');
  });

  afterAll(async () => {
    // EL PATROCINADO HAY QUE BORRARLO A MANO. `cleanDb` trunca `User` CASCADE, y
    // `SponsoredAd` no tiene ninguna FK a `User` (su única relación es con `Category`,
    // que se excluye a propósito de la limpieza por suite): sobreviviría a este archivo
    // y se colaría en TODA búsqueda de `moviles` en página 1 de las suites siguientes.
    // Es la misma clase de fuga que `helpers/db.ts` documenta para FooterColumn/NavItem.
    await prisma.sponsoredAd.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  let seq = 0;

  /** Crea un anuncio ACTIVE y lo indexa. `indexListing` ya espera a la tarea de Meili. */
  async function crearAnuncio(
    titulo: string,
    sufijo: string,
    opts: { destacado?: boolean } = {},
  ): Promise<string> {
    seq += 1;
    const creado = await prisma.listing.create({
      data: {
        title: titulo,
        slug: `impresiones-${sufijo}-${seq}`,
        description: `Anuncio de la suite de impresiones (${sufijo})`,
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    if (opts.destacado) {
      // boostScore = 1 en el documento indexado → el anuncio entra ADEMÁS en el bloque
      // «Promocionados», que es lo que hace falta para probar la unión sin duplicado.
      await prisma.entitlement.create({
        data: {
          userId: sellerId,
          type: EntitlementType.FEATURED_LISTING,
          listingId: creado.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }

    const fila = await prisma.listing.findUniqueOrThrow({
      where: { id: creado.id },
      include: INDEX_INCLUDE,
    });
    await search.indexListing(fila as never);
    return creado.id;
  }

  function buscar(query: string, visitante = 'visitante-base') {
    return request(app.getHttpServer())
      .get(`/api/search?${query}`)
      .set('x-visitor-hash', visitante)
      .expect(200);
  }

  const hoyUtc = () => new Date().toISOString().slice(0, 10);
  const cuboVivo = () => `imp:bucket:${hoyUtc()}`;

  async function filaDiaria(listingId: string) {
    return prisma.listingImpressionDaily.findFirst({ where: { listingId } });
  }

  async function totalDe(listingId: string): Promise<number> {
    const fila = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { impressionCount: true },
    });
    return fila.impressionCount;
  }

  /**
   * BARRERA DE ORDEN — el problema de «demostrar que algo NO pasó».
   *
   * El contador es fire-and-forget: cuando la respuesta HTTP vuelve, el `HINCRBY` aún
   * no ha ocurrido. Para las aserciones POSITIVAS basta con esperar a que el contador
   * aparezca. Para las NEGATIVAS («la búsqueda repetida no volvió a contar») esperar un
   * rato y mirar sería un falso verde en cuanto el runner vaya lento.
   *
   * Así que se usa un CENTINELA: después de la operación que no debe contar se lanza una
   * búsqueda distinta, con un visitante nuevo, sobre un anuncio que no comparte ninguna
   * búsqueda con los demás; y se espera a que ESE contador suba. Como las órdenes viajan
   * por la misma conexión de Redis y en orden, ver el incremento del centinela demuestra
   * que la decisión de la operación anterior —contar o no— ya está tomada.
   *
   * El total del centinela se mide sumando Redis + base, para que siga valiendo después
   * de un volcado (que vacía Redis y escribe en la base).
   */
  let centinelaEsperado = 0;

  async function totalCentinela(): Promise<number> {
    const enRedis = Number((await redis.hget(cuboVivo(), centinelaId)) ?? 0);
    const fila = await filaDiaria(centinelaId);
    return enRedis + (fila?.count ?? 0);
  }

  async function barreraDeOrden(): Promise<void> {
    centinelaEsperado += 1;
    await buscar(`q=${CENTINELA}`, `centinela-${centinelaEsperado}`);
    await pollUntil(async () => (await totalCentinela()) >= centinelaEsperado);
  }

  /** Espera a que los anuncios estén acumulados en Redis y vuelca. */
  async function acumularYVolcar(ids: string[]): Promise<void> {
    await pollUntil(async () => {
      const cubo = await redis.hgetall(cuboVivo());
      return ids.every((id) => Number(cubo[id] ?? 0) > 0);
    });
    await impressions.flushImpressions();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — la impresión se cuenta
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — una búsqueda servida cuenta una impresión por anuncio', () => {
    it('los N anuncios servidos acaban con +1 en la tabla diaria de HOY y en el total', async () => {
      const a = await crearAnuncio(`${MARCA} alfa`, 'b1-a');
      const b = await crearAnuncio(`${MARCA} beta`, 'b1-b');

      const res = await buscar(`q=${MARCA}%20alfa%20beta`, 'b1-visitante');
      const servidos = (res.body.hits as { id: string }[]).map((h) => h.id);
      expect(servidos).toEqual(expect.arrayContaining([a, b]));

      await acumularYVolcar([a, b]);

      for (const id of [a, b]) {
        const fila = await filaDiaria(id);
        expect(fila?.count).toBe(1);
        // La fecha es la de HOY en UTC, el mismo troceo que `ListingViewDaily`: es lo
        // que permite que A2 pinte las dos series sobre el mismo eje.
        expect(fila?.date.toISOString().slice(0, 10)).toBe(hoyUtc());
        expect(await totalDe(id)).toBe(1);
      }
    });

    it('un anuncio que sale en `hits` Y en «Promocionados» cuenta UNA vez, no dos', async () => {
      // La unión, no la suma. El bloque de destacados se repite dentro de `hits` a
      // propósito (política de ordenación C), así que contar las dos listas por separado
      // daría dos impresiones al mismo anuncio en la misma respuesta — que por
      // definición es una.
      const destacado = await crearAnuncio(`${MARCA} promocionado`, 'b1-promo', {
        destacado: true,
      });

      const res = await buscar(`q=${MARCA}%20promocionado&page=1`, 'b1-promo-visitante');
      const enHits = (res.body.hits as { id: string }[]).some((h) => h.id === destacado);
      const enFeatured = (res.body.featured as { id: string }[]).some((h) => h.id === destacado);
      expect(enHits).toBe(true);
      expect(enFeatured).toBe(true); // si esto cae, el test ya no prueba lo que dice

      await acumularYVolcar([destacado]);

      expect((await filaDiaria(destacado))?.count).toBe(1);
      expect(await totalDe(destacado)).toBe(1);
    });

    it('el PATROCINADO no cuenta: no es un anuncio y no deja rastro', async () => {
      const anuncio = await crearAnuncio(`${MARCA} concategoria`, 'b1-cat');
      const patrocinado = await prisma.sponsoredAd.create({
        data: {
          title: 'Patrocinado de prueba',
          description: 'No es un anuncio del marketplace',
          imageUrl: 'http://localhost:9000/marketplace-test/x.jpg',
          targetUrl: 'https://example.com',
          categoryId,
          active: true,
        },
        select: { id: true },
      });

      const res = await buscar(
        `q=${MARCA}%20concategoria&category=${categorySlug}&page=1`,
        'b1-patrocinado',
      );
      const inyectado = (res.body.hits as { __sponsored?: boolean; id: string }[]).find(
        (h) => h.__sponsored === true,
      );
      expect(inyectado?.id).toBe(patrocinado.id); // el camino se ha ejercido de verdad

      // SE MIRA EL ACUMULADOR ANTES DE VOLCAR, y esto no es un detalle: después del
      // volcado el cubo está vacío por definición, así que comprobarlo entonces no
      // demostraría nada. Lo que hay que ver es que el id del patrocinado NUNCA llegó
      // a entrar en el cubo — el `JOIN "Listing"` del volcado lo habría filtrado
      // igualmente, pero eso sería el tercer cinturón, no el primero.
      await pollUntil(async () => Number((await redis.hgetall(cuboVivo()))[anuncio] ?? 0) > 0);
      expect(await redis.hget(cuboVivo(), patrocinado.id)).toBeNull();

      await acumularYVolcar([anuncio]);
      expect(await filaDiaria(patrocinado.id)).toBeNull();
    });

    it('una búsqueda sin resultados no acumula nada', async () => {
      await buscar('q=noexistenadaconestapalabraxyz', 'b1-vacio');
      await barreraDeOrden();

      const cubo = await redis.hgetall(cuboVivo());
      // Sólo puede haber quedado el centinela de la barrera de orden.
      expect(Object.keys(cubo).filter((id) => id !== centinelaId)).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — el dedup es por búsqueda
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 2 — el mismo visitante repitiendo la misma búsqueda no re-cuenta', () => {
    it('cinco veces la misma búsqueda del mismo visitante → UNA impresión', async () => {
      const anuncio = await crearAnuncio(`${MARCA} dedup`, 'b2-dedup');

      for (let i = 0; i < 5; i++) {
        await buscar(`q=${MARCA}%20dedup`, 'b2-mismo-visitante');
      }
      await barreraDeOrden();
      await acumularYVolcar([anuncio]);

      expect((await filaDiaria(anuncio))?.count).toBe(1);
      expect(await totalDe(anuncio)).toBe(1);
    });

    it('dos visitantes DISTINTOS haciendo la misma búsqueda → dos impresiones', async () => {
      const anuncio = await crearAnuncio(`${MARCA} dosvisitantes`, 'b2-dos');

      await buscar(`q=${MARCA}%20dosvisitantes`, 'b2-visitante-A');
      await buscar(`q=${MARCA}%20dosvisitantes`, 'b2-visitante-B');
      await acumularYVolcar([anuncio]);

      expect((await filaDiaria(anuncio))?.count).toBe(2);
      expect(await totalDe(anuncio)).toBe(2);
    });

    it('LA MUTACIÓN DEL BFF: sin la cabecera reenviada, dos visitantes colapsan en uno', async () => {
      // Es lo que ocurriría si `/busqueda` dejara de reenviar `x-visitor-hash`: como la
      // página es un Server Component, TODAS las peticiones llegarían con la IP del
      // servidor de Next y el mismo user-agent, así que el dedup las trataría como un
      // único visitante y mataría todas las impresiones menos la primera.
      //
      // El test no aprueba esa degradación: la FIJA. Sin cabecera se cuenta de MENOS
      // (nunca de más), y es la prueba de que la cabecera es la pieza que hace que dos
      // visitantes se distingan — compárese con el test de aquí arriba, idéntico salvo
      // por la cabecera, que sí da dos.
      const anuncio = await crearAnuncio(`${MARCA} sincabecera`, 'b2-sin');

      const sinCabecera = () =>
        request(app.getHttpServer()).get(`/api/search?q=${MARCA}%20sincabecera`).expect(200);
      await sinCabecera();
      await sinCabecera();
      await barreraDeOrden();
      await acumularYVolcar([anuncio]);

      expect((await filaDiaria(anuncio))?.count).toBe(1);
    });

    it('el mismo visitante en OTRA página cuenta: es otra aparición, no una repetición', async () => {
      const anuncio = await crearAnuncio(`${MARCA} paginado`, 'b2-pag');

      await buscar(`q=${MARCA}%20paginado&page=1`, 'b2-paginador');
      await buscar(`q=${MARCA}%20paginado&page=1&hitsPerPage=24`, 'b2-paginador');
      await acumularYVolcar([anuncio]);

      // Dos peticiones con parámetros distintos = dos búsquedas distintas.
      expect((await filaDiaria(anuncio))?.count).toBe(2);
    });

    it('el ORDEN de los parámetros no crea una búsqueda nueva', async () => {
      const anuncio = await crearAnuncio(`${MARCA} orden`, 'b2-orden');

      await buscar(`q=${MARCA}%20orden&page=1`, 'b2-ordenador');
      await buscar(`page=1&q=${MARCA}%20orden`, 'b2-ordenador');
      await barreraDeOrden();
      await acumularYVolcar([anuncio]);

      expect((await filaDiaria(anuncio))?.count).toBe(1);
    });

    it('sumar impresiones de dos volcados distintos ACUMULA en la misma fila del día', async () => {
      const anuncio = await crearAnuncio(`${MARCA} dosvolcados`, 'b2-volcados');

      await buscar(`q=${MARCA}%20dosvolcados`, 'b2-v1');
      await acumularYVolcar([anuncio]);
      expect((await filaDiaria(anuncio))?.count).toBe(1);

      // Segundo ciclo completo: el `ON CONFLICT … DO UPDATE` suma sobre lo que había,
      // no lo pisa. Y de paso demuestra que el cubo vivo quedó LIBRE tras el RENAME:
      // este incremento cae en un cubo nuevo y el siguiente volcado lo encuentra.
      await buscar(`q=${MARCA}%20dosvolcados`, 'b2-v2');
      await acumularYVolcar([anuncio]);

      expect((await filaDiaria(anuncio))?.count).toBe(2);
      expect(await totalDe(anuncio)).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 4 — las alertas NO cuentan
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 4 — el contador vive en el CONTROLADOR, no en el servicio', () => {
    it('un barrido por `SearchService.search()` (la vía de las alertas) no genera impresiones', async () => {
      const anuncio = await crearAnuncio(`${MARCA} alertas`, 'b4-alertas');

      // Exactamente lo que hacen `alerts.service.ts` y `alert-matching.service.ts`:
      // llamar al SERVICIO. Si el contador viviera ahí, cada barrido de alertas —una
      // consulta por anuncio y alerta, dentro de un worker— inflaría las veces-listado
      // de anuncios que ningún usuario ha visto.
      const resultado = await search.search({ q: `${MARCA} alertas`, hitsPerPage: 10 });
      expect(resultado.hits.some((h) => (h as { id: string }).id === anuncio)).toBe(true);

      await barreraDeOrden();
      await impressions.flushImpressions();

      expect(await filaDiaria(anuncio)).toBeNull();
      expect(await totalDe(anuncio)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 5 — el drenaje
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 5 — el drenaje es atómico e idempotente', () => {
    it('deja el cubo vivo borrado y no vuelve a contar lo ya volcado', async () => {
      const anuncio = await crearAnuncio(`${MARCA} idempotente`, 'b5-idem');

      await buscar(`q=${MARCA}%20idempotente`, 'b5-visitante');
      await acumularYVolcar([anuncio]);

      expect(await redis.hget(cuboVivo(), anuncio)).toBeNull();

      // Volcar otra vez sin búsquedas nuevas no puede duplicar nada.
      await impressions.flushImpressions();
      await impressions.flushImpressions();

      expect((await filaDiaria(anuncio))?.count).toBe(1);
      expect(await totalDe(anuncio)).toBe(1);
    });

    it('un cubo HUÉRFANO de un volcado fallido se recupera en el ciclo siguiente', async () => {
      const anuncio = await crearAnuncio(`${MARCA} huerfano`, 'b5-huerfano');

      // Es exactamente el estado que deja un proceso que muere entre el RENAME y el
      // borrado: el hash renombrado sobrevive en Redis, con sus contadores dentro.
      const huerfano = `imp:bucket:${hoyUtc()}:draining:aabbccddeeff`;
      await redis.hincrby(huerfano, anuncio, 7);

      await impressions.flushImpressions();

      expect((await filaDiaria(anuncio))?.count).toBe(7);
      expect(await totalDe(anuncio)).toBe(7);
      expect(await redis.exists(huerfano)).toBe(0);
    });

    it('un cubo de OTRO DÍA se escribe con SU fecha, no con la de hoy', async () => {
      // La fecha viaja en el nombre de la clave justamente para esto: un volcado que
      // cruza la medianoche UTC tiene que escribir lo de ayer con la fecha de ayer.
      const anuncio = await crearAnuncio(`${MARCA} ayer`, 'b5-ayer');
      const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await redis.hincrby(`imp:bucket:${ayer}`, anuncio, 3);
      await impressions.flushImpressions();

      const fila = await filaDiaria(anuncio);
      expect(fila?.count).toBe(3);
      expect(fila?.date.toISOString().slice(0, 10)).toBe(ayer);
    });

    it('un anuncio BORRADO no aborta el trozo: los demás se escriben igual', async () => {
      // La ventana entre acumular y volcar es de hasta 15 minutos, así que un anuncio
      // puede desaparecer por el camino. Sin el `JOIN "Listing"` del volcado, esa única
      // fila muerta reventaría la clave foránea y se llevaría por delante las
      // impresiones de todos sus compañeros de trozo.
      const vivo = await crearAnuncio(`${MARCA} superviviente`, 'b5-vivo');

      const cubo = `imp:bucket:${hoyUtc()}:draining:112233445566`;
      await redis.hincrby(cubo, vivo, 2);
      await redis.hincrby(cubo, 'id-de-un-anuncio-que-ya-no-existe', 5);

      await expect(impressions.flushImpressions()).resolves.toEqual(
        expect.objectContaining({ buckets: 1 }),
      );

      expect((await filaDiaria(vivo))?.count).toBe(2);
      expect(await redis.exists(cubo)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Retención
  // ═══════════════════════════════════════════════════════════════════════════

  describe('purga a 180 días', () => {
    it('borra el detalle diario viejo de las DOS tablas y respeta el reciente', async () => {
      const anuncio = await crearAnuncio(`${MARCA} purga`, 'purga');
      const viejo = new Date();
      viejo.setUTCDate(viejo.getUTCDate() - 200);
      viejo.setUTCHours(0, 0, 0, 0);
      const reciente = new Date();
      reciente.setUTCDate(reciente.getUTCDate() - 10);
      reciente.setUTCHours(0, 0, 0, 0);

      await prisma.listingImpressionDaily.createMany({
        data: [
          { listingId: anuncio, date: viejo, count: 9 },
          { listingId: anuncio, date: reciente, count: 4 },
        ],
      });
      await prisma.listingViewDaily.createMany({
        data: [
          { listingId: anuncio, date: viejo, count: 9 },
          { listingId: anuncio, date: reciente, count: 4 },
        ],
      });
      // El total NO se toca al purgar: es lo que hace que perder el detalle antiguo no
      // borre el número redondo.
      await prisma.listing.update({
        where: { id: anuncio },
        data: { impressionCount: 13, viewCount: 13 },
      });

      await impressions.purgeOldDailyRows();

      const impresiones = await prisma.listingImpressionDaily.findMany({
        where: { listingId: anuncio },
      });
      const vistas = await prisma.listingViewDaily.findMany({ where: { listingId: anuncio } });

      expect(impresiones.map((f) => f.count)).toEqual([4]);
      expect(vistas.map((f) => f.count)).toEqual([4]);
      expect(await totalDe(anuncio)).toBe(13);
    });
  });
});
