/**
 * H9 — LA CONSULTA QUE EL MAPA NO TENÍA QUE PAGAR.
 *
 * EL DEFECTO, que era de coste y no de pantalla. En vista mapa las dos páginas montan el mapa
 * SIN `FeaturedBlock`, pero el mapa fuerza `page=1` para traer todos los marcadores de una vez
 * — y `page === 1` es justamente la condición con la que el controlador resolvía el bloque. Así
 * que cada carga de mapa pagaba una consulta a Meilisearch (dos desde la rotación, si hay más
 * de cuatro destacados compitiendo) para devolver cuatro anuncios que nadie llegaba a ver.
 *
 * SE MIDE CONTANDO LAS CONSULTAS REALES, no observando la respuesta: el síntoma de este defecto
 * es invisible desde fuera —el `featured` sobrante lo ignoraba el frontend en silencio—, así
 * que un test que mirase el cuerpo de la respuesta habría pasado en verde con el defecto
 * dentro. Se espía `SearchService.search` mientras se sirve la petición, molde de #15.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · no mirar `skipFeatured` en el controlador → el mapa sigue pagando la consulta;
 *  · saltarse el bloque también sin el parámetro → desaparecería donde SÍ debe estar, que es
 *    un defecto mucho peor que el que se venía a arreglar.
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
import {
  grupoDeLaVentana,
  FEATURED_ROTATION_WINDOW_SECONDS,
} from 'src/modules/search/featured-rotation';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';
const Q = 'H9Mapa';
/** Seis destacados en cuatro huecos: dos grupos (4 + 2). Ver `conElGrupoLleno`. */
const GRUPOS = 2;

describe('H9 — en vista mapa no se resuelve el bloque (e2e)', () => {
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

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const user = await prisma.user.create({
      data: {
        email: 'h9@example.com',
        name: 'H9',
        slug: 'h9-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;

    // SEIS destacados: más de los cuatro huecos, así que con la rotación el bloque puede
    // costar DOS consultas. Es el escenario donde el ahorro del mapa se nota más.
    const base = Date.now();
    for (let i = 0; i < 6; i++) {
      const anuncio = await prisma.listing.create({
        data: {
          title: `${Q} Telefono`,
          slug: `h9-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          description: `${Q}`,
          price: new Prisma.Decimal('100.00'),
          currency: 'EUR',
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          categoryId,
          sellerId: userId,
          publishedAt: new Date(base - i * 1_000),
        },
      });
      await prisma.entitlement.create({
        data: {
          userId,
          type: EntitlementType.FEATURED_LISTING,
          listingId: anuncio.id,
          startsAt: new Date(base - i * 60_000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
          revokedAt: null,
        },
      });
      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id: anuncio.id },
        include: INDEX_INCLUDE,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await searchService.indexListing(listing as any);
      await waitForDocumentWhere<{ boostScore: number }>(
        meili,
        INDEX_NAME,
        anuncio.id,
        (d) => d.boostScore === 1,
        { description: `a que el destacado ${i} de H9 se indexe` },
      );
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Cuenta las llamadas REALES a `SearchService.search` mientras se sirve una petición. */
  async function consultasDurante(fn: () => Promise<unknown>): Promise<number> {
    const original = searchService.search.bind(searchService);
    let llamadas = 0;
    const espia = jest.spyOn(searchService, 'search').mockImplementation((params) => {
      llamadas += 1;
      return original(params);
    });
    try {
      await fn();
      return llamadas;
    } finally {
      espia.mockRestore();
    }
  }

  function buscar(extra: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/api/search')
      .query({ q: Q, ...extra })
      .expect(200);
  }

  /**
   * EL RELOJ SE GOBIERNA, y aquí hizo falta aprenderlo a golpes: seis destacados son DOS
   * grupos —cuatro y dos—, así que «cuántos trae el bloque» depende de en qué ventana caiga la
   * petición. La primera versión de estos tests afirmaba `length === 4` sin más y salía verde o
   * roja según la hora a la que se ejecutara la suite, que es peor que no tenerla.
   *
   * Se fija la ventana en una cuyo turno sea el PRIMER grupo, que es el lleno. Lo que estos
   * tests miden —que el bloque se resuelve cuando nadie pide saltárselo— no tiene nada que ver
   * con qué grupo toca, así que fijarlo no debilita la barrera: la vuelve determinista.
   */
  async function conElGrupoLleno<T>(fn: () => Promise<T>): Promise<T> {
    const ventanaActual = Math.floor(Date.now() / 1000 / FEATURED_ROTATION_WINDOW_SECONDS);
    let instante = 0;
    for (let i = 0; i <= GRUPOS; i++) {
      const ventana = ventanaActual + i;
      if (grupoDeLaVentana(ventana * FEATURED_ROTATION_WINDOW_SECONDS * 1000, GRUPOS) === 1) {
        instante = (ventana * FEATURED_ROTATION_WINDOW_SECONDS + 1) * 1000;
        break;
      }
    }
    const espia = jest.spyOn(Date, 'now').mockReturnValue(instante);
    try {
      return await fn();
    } finally {
      espia.mockRestore();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — el mapa no paga la consulta
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 1 — con `skipFeatured` se resuelve SOLO la lista: una consulta, no dos ni tres', async () => {
    const llamadas = await consultasDurante(() =>
      buscar({ skipFeatured: 'true', hitsPerPage: '200' }),
    );

    expect(llamadas).toBe(1); // la lista y nada más
  }, 60_000);

  it('y `featured` viene vacío, que es lo que el mapa iba a hacer con él de todos modos', async () => {
    const res = await buscar({ skipFeatured: 'true', hitsPerPage: '200' });

    expect(res.body.featured).toEqual([]);
    // Lo que el mapa SÍ necesita sigue intacto: los marcadores y el conteo.
    expect(res.body.hits.length).toBe(6);
    expect(res.body.totalHits).toBe(6);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — fuera del mapa, nada cambia
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 2 — sin el parámetro el bloque se resuelve y se sirve, como siempre', async () => {
    const res = await conElGrupoLleno(() => buscar());

    expect(res.body.featured.length).toBe(4); // el grupo lleno del anillo
    expect(res.body.totalHits).toBe(6);
  }, 60_000);

  it('y sigue costando lo que costaba: la lista más el bloque (más su turno si toca)', async () => {
    // El ahorro del mapa NO puede salir de haberle quitado el bloque a quien sí lo pinta.
    const llamadas = await consultasDurante(() => buscar());

    expect(llamadas).toBeGreaterThanOrEqual(2);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — el contrato no rompe a nadie
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 3 — es un opt-out, y sólo el `true` explícito cuenta', () => {
    it('un cliente que no lo manda recibe el bloque (el de siempre)', async () => {
      const res = await conElGrupoLleno(() => buscar());
      expect(res.body.featured.length).toBe(4);
    }, 60_000);

    it('`skipFeatured=false` NO salta el bloque — la cadena «false» es verdadera en JS', async () => {
      // El mismo cuidado que `conVideo`: sin el `Transform` del DTO, `?skipFeatured=false`
      // habría hecho exactamente lo contrario de lo que pide.
      const res = await conElGrupoLleno(() => buscar({ skipFeatured: 'false' }));
      expect(res.body.featured.length).toBe(4);
    }, 60_000);

    it('en la página 2 da igual: allí nunca hubo bloque', async () => {
      const res = await buscar({ page: '2', hitsPerPage: '4' });
      expect(res.body.featured).toEqual([]);
    }, 60_000);
  });
});
