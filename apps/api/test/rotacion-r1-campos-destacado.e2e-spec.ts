/**
 * ROTACIÓN DE DESTACADOS — R1: el dato en el índice (e2e).
 *
 * R1 no cambia lo que ve nadie: añade al documento de Meilisearch las dos marcas de tiempo
 * del destacado (`featuredStartsAt`, `featuredExpiresAt`) para que R2 pueda repartir la
 * vitrina por turnos en vez de congelarla en los 4 de siempre. Ver
 * docs/diseno-rotacion-destacados.md (R1).
 *
 * LAS CUATRO BARRERAS QUE SE COMPRUEBAN AQUÍ, y por qué sólo un e2e puede hacerlo:
 *  1. LOS CAMPOS LLEGAN AL ÍNDICE REAL. Que `toDocument` los emita se fija en un unitario
 *     (search.service.featured-fields.spec.ts); que Meilisearch los acepte, los guarde y los
 *     devuelva —incluidos los `null`, que un motor podría descartar al serializar— sólo se
 *     sabe preguntándoselo a Meilisearch.
 *  2. SIN CONSULTA EXTRA AL INDEXAR. Se cuentan las lecturas REALES de `Entitlement`
 *     mientras se construye e indexa el documento, espiando el Prisma de la APLICACIÓN
 *     (molde de #15). Si alguien resolviera la fecha de concesión con una consulta propia,
 *     este número dejaría de ser 0 y el indexado masivo pasaría a costar una consulta por
 *     anuncio.
 *  3. LOS AJUSTES ESTÁN APLICADOS DE VERDAD. No basta con que la constante los liste: R2
 *     ordenará por `featuredStartsAt` y filtrará por `featuredExpiresAt`, y si no están en
 *     los ajustes del índice Meilisearch responde 400. Se comprueba leyendo los ajustes Y
 *     lanzando la consulta EXACTA que R2 va a lanzar.
 *  4. EL BLOQUE SE ALIMENTA DE ESTOS CAMPOS. Cuando se escribió esta ráfaga, aquí se fijaba
 *     que el bloque seguía CONGELADO («los 4 primeros del orden pedido»), con el aviso de que
 *     R2 vendría a cambiarlo a mano. R2 llegó: el reparto por turnos y sus garantías se
 *     comprueban en `rotacion-r2-turnos.e2e-spec.ts`, y aquí queda lo que es de R1 — que el
 *     conteo no se contamina y que los campos viajan en la respuesta con nombres que no
 *     pisan el `featuredUntil` del propietario.
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient, Prisma } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForDocumentWhere } from './helpers/meili';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';

/** Lo que R1 escribe en el documento, que es lo único que este fichero mira. */
interface DocDestacado extends Record<string, unknown> {
  boostScore: number;
  featuredStartsAt: number | null;
  featuredExpiresAt: number | null;
}

describe('ROTACIÓN R1 — las marcas del destacado en el índice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let searchService: SearchService;
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    searchService = app.get(SearchService);

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'rota-r1-seller@example.com',
        name: 'RotaR1 Seller',
        slug: 'rota-r1-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function crearAnuncio(title: string, publishedAt: Date) {
    const slug = `rota-r1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return prisma.listing.create({
      data: {
        title,
        slug,
        description: title,
        price: new Prisma.Decimal('100.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        categoryId,
        sellerId: userId,
        publishedAt,
      },
    });
  }

  /** Un destacado con su periodo. `startsAt` explícito para poder afirmar sobre él. */
  async function destacar(listingId: string, startsAt: Date, expiresAt: Date | null) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        startsAt,
        expiresAt,
        revokedAt: null,
      },
    });
  }

  /** El mismo camino que `IndexingProcessor.handleIndex`, sin la cola por medio. */
  async function indexar(listingId: string) {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchService.indexListing(listing as any);
  }

  const segundos = (d: Date) => Math.floor(d.getTime() / 1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — los campos llegan al índice real
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — los campos en el documento real', () => {
    it('un destacado lleva su concesión y su fin al índice', async () => {
      const concedido = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const vence = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      const anuncio = await crearAnuncio('RotaR1Campos Telefono', new Date());
      await destacar(anuncio.id, concedido, vence);
      await indexar(anuncio.id);

      const doc = await waitForDocumentWhere<DocDestacado>(
        meili,
        INDEX_NAME,
        anuncio.id,
        (d) => d.boostScore === 1,
        { description: 'a que el destacado se indexe con boostScore=1' },
      );

      expect(doc.featuredStartsAt).toBe(segundos(concedido));
      expect(doc.featuredExpiresAt).toBe(segundos(vence));
    }, 30_000);

    it('un anuncio SIN destacar lleva los campos a null, no ausentes', async () => {
      // La distinción que importa para R2: en Meilisearch `campo IS NULL` casa con los nulos
      // explícitos, pero un atributo que no viaja necesita `NOT campo EXISTS`. Que el
      // documento salga de aquí con nulos no basta — hay que ver que Meilisearch los
      // CONSERVA al guardarlo.
      const anuncio = await crearAnuncio('RotaR1Campos Sin Destacar', new Date());
      await indexar(anuncio.id);

      const doc = await waitForDocumentWhere<DocDestacado>(
        meili,
        INDEX_NAME,
        anuncio.id,
        (d) => d.boostScore === 0,
        { description: 'a que el no destacado se indexe' },
      );

      expect(doc.featuredStartsAt).toBeNull();
      expect(doc.featuredExpiresAt).toBeNull();
      expect('featuredStartsAt' in doc).toBe(true);
      expect('featuredExpiresAt' in doc).toBe(true);
    }, 30_000);

    it('un destacado caducado no deja marcas (el mismo criterio que boostScore)', async () => {
      const anuncio = await crearAnuncio('RotaR1Campos Caducado', new Date());
      await destacar(anuncio.id, new Date(Date.now() - 10_000), new Date(Date.now() - 1_000));
      await indexar(anuncio.id);

      const doc = await waitForDocumentWhere<DocDestacado>(
        meili,
        INDEX_NAME,
        anuncio.id,
        (d) => d.boostScore === 0,
        { description: 'a que el caducado se indexe con boostScore=0' },
      );

      expect(doc.featuredStartsAt).toBeNull();
      expect(doc.featuredExpiresAt).toBeNull();
    }, 30_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — sin consulta extra al indexar
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 2 — indexar no consulta la tabla de entitlements ni una vez', async () => {
    // El dato viene del `include` que ya se cargaba desde RF.8 (de ahí sale `boostScore`):
    // R1 pide UNA COLUMNA MÁS de unas filas que ya viajaban. Si alguien resolviera la fecha
    // de concesión por su cuenta, aquí saltaría — y en el reindexado masivo serían tantas
    // consultas como anuncios.
    const anuncio = await crearAnuncio('RotaR1Consultas Telefono', new Date());
    await destacar(anuncio.id, new Date(), new Date(Date.now() + 86_400_000));

    const appPrisma = app.get(PrismaService);
    const espiados = ['findMany', 'findFirst', 'findUnique', 'count'] as const;
    const originales = new Map(
      espiados.map((m) => [m, appPrisma.entitlement[m].bind(appPrisma.entitlement)]),
    );
    let lecturasEntitlement = 0;
    for (const metodo of espiados) {
      (appPrisma.entitlement as unknown as Record<string, unknown>)[metodo] = (
        ...args: unknown[]
      ) => {
        lecturasEntitlement += 1;
        return (originales.get(metodo) as (...a: unknown[]) => unknown)(...args);
      };
    }

    try {
      // El camino real de `IndexingProcessor.handleIndex`, con el Prisma de la aplicación.
      const listing = await appPrisma.listing.findUniqueOrThrow({
        where: { id: anuncio.id },
        include: INDEX_INCLUDE,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await searchService.indexListing(listing as any);

      expect(lecturasEntitlement).toBe(0); // CERO. El dato ya venía en el include.
    } finally {
      for (const metodo of espiados) {
        (appPrisma.entitlement as unknown as Record<string, unknown>)[metodo] =
          originales.get(metodo);
      }
    }

    // Y comprobado que el documento salió correcto pese a no haber consultado nada.
    const doc = await waitForDocumentWhere<DocDestacado>(
      meili,
      INDEX_NAME,
      anuncio.id,
      (d) => d.boostScore === 1,
      { description: 'a que el destacado de la barrera 2 se indexe' },
    );
    expect(doc.featuredStartsAt).not.toBeNull();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — los ajustes del índice, aplicados de verdad
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 3 — el índice acepta lo que R2 va a pedirle', () => {
    it('los ajustes declaran cada campo donde R2 lo usa, y el techo está subido', async () => {
      const settings = await meili.index(INDEX_NAME).getSettings();

      expect(settings.sortableAttributes).toContain('featuredStartsAt');
      expect(settings.filterableAttributes).toContain('featuredExpiresAt');
      // Sin esto el anillo de R2 se cortaría en los primeros 1000 destacados.
      expect(settings.pagination?.maxTotalHits ?? 1000).toBeGreaterThan(1000);
    });

    it('la consulta EXACTA de R2 (ordenar por turno + descartar vencidos) no da error', async () => {
      // Ésta es la prueba que de verdad importa: leer los ajustes dice lo que se pidió;
      // esto dice lo que el motor hace. Si un campo estuviera en la lista equivocada,
      // Meilisearch respondería 400 y R2 se estrellaría en producción, no aquí.
      const ahora = Math.floor(Date.now() / 1000);

      const res = await meili.index(INDEX_NAME).search('', {
        filter: [`boostScore = 1`, `featuredExpiresAt > ${ahora} OR featuredExpiresAt IS NULL`],
        sort: ['featuredStartsAt:asc'],
        page: 1,
        hitsPerPage: 4,
      });

      expect(Array.isArray(res.hits)).toBe(true);
      // El conteo exhaustivo que R2 usará para saber cuántos grupos tiene el ciclo.
      expect(typeof res.totalHits).toBe('number');
      expect(typeof res.totalPages).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 4 — R1 no cambia lo que ve nadie
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 4 — el bloque, y lo que R1 le aporta', () => {
    beforeAll(async () => {
      // Cinco destacados que compiten por cuatro huecos.
      const base = Date.now() - 60_000;
      for (let i = 0; i < 5; i++) {
        const anuncio = await crearAnuncio('RotaR1Vitrina Telefono', new Date(base + i * 1_000));
        await destacar(
          anuncio.id,
          new Date(base - i * 1_000),
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
        await indexar(anuncio.id);
        await waitForDocumentWhere<DocDestacado>(
          meili,
          INDEX_NAME,
          anuncio.id,
          (d) => d.boostScore === 1,
          { description: `a que el destacado ${i} de la vitrina se indexe` },
        );
      }
    }, 90_000);

    async function vitrina(): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'RotaR1Vitrina' })
        .expect(200);
      return (res.body.featured as { id: string }[]).map((h) => h.id);
    }

    /**
     * AQUÍ VIVÍA «siguen siendo los 4 primeros del orden pedido — el más antiguo se queda
     * fuera», que fijaba el reparto CONGELADO y avisaba de que R2 lo cambiaría a mano y a
     * propósito. R2 llegó y lo cambió: el bloque ya no son los 4 primeros de nada, sino el
     * grupo que le toca a esta ventana, y en un ciclo salen los cinco.
     *
     * No se sustituye por su versión rotada AQUÍ: eso es exactamente lo que comprueba
     * `rotacion-r2-turnos.e2e-spec.ts`, con el reloj gobernado y un oráculo independiente.
     * Este fichero se queda con lo que es suyo — que los campos de R1 llegan al índice y
     * alimentan el bloque — y no duplica las garantías del turno.
     */
    it('dentro de una misma ventana el bloque es estable entre peticiones', async () => {
      const primera = await vitrina();
      const segunda = await vitrina();

      expect(segunda).toEqual(primera);
    }, 30_000);

    it('el conteo sigue sin contaminarse y los campos nuevos viajan en los hits', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'RotaR1Vitrina' })
        .expect(200);

      // `totalHits` sale sólo de la consulta principal: los 5 anuncios reales, ni el bloque
      // ni sus repeticiones lo inflan.
      expect(res.body.totalHits).toBe(5);

      // Los campos nuevos SÍ se ven en la respuesta (normalizeHit hace spread del documento,
      // igual que ya ocurría con boostScore o _geo). Se afirma a propósito: es un cambio de
      // contrato, pequeño pero real, y los nombres son distintos de `featuredUntil` —el ISO
      // que sirve la vista del propietario— justamente para que no se pisen.
      const hit = (res.body.hits as Record<string, unknown>[])[0];
      expect(typeof hit.featuredStartsAt).toBe('number');
      expect(hit.featuredUntil).toBeUndefined();
    }, 30_000);
  });
});
