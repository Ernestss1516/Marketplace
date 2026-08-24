/**
 * V-4 — «SOLO CON VÍDEO»: el filtro que faltaba.
 *
 * EL HUECO. `hasVideo` viajaba en el documento indexado desde la ráfaga de visualización,
 * pero no estaba en `CORE_FILTERABLE_ATTRIBUTES`: Meilisearch lo guardaba y se negaba a
 * filtrar por él. El comprador veía el indicador de vídeo en las tarjetas y no tenía forma
 * de pedir sólo ésas — para una ventaja Pro que se vende como diferenciador, una vía de
 * descubrimiento cerrada.
 *
 * LO QUE SE COMPRUEBA AQUÍ, y por qué contra el índice REAL: declarar el atributo en una
 * constante no lo hace filtrable. Meilisearch tiene que haber APLICADO los settings, y esa
 * aplicación es asíncrona (`updateSettings` encola una tarea). Un test que sólo mirase la
 * constante pasaría con el índice sin enterarse — que es exactamente el fallo que se quiere
 * impedir.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (V-4).
 */
import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb, buildMeiliClient } from './helpers/db';
import { INDEX_INCLUDE, LISTINGS_INDEX, SearchService } from 'src/modules/search/search.service';

describe('Búsqueda — filtro «solo con vídeo» (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let search: SearchService;
  let sellerId: string;
  let categoryId: string;

  const VIDEO_URL = `${process.env.S3_PUBLIC_URL}/listing-videos/x/v.mp4`;
  /** Palabra propia de esta suite: acota la búsqueda a SUS anuncios y nada más. */
  const MARCA = 'filtrovideoxyz';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    search = app.get(SearchService);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const seller = await prisma.user.create({
      data: {
        email: 'filtro-video@example.com',
        name: 'Filtro',
        slug: 'filtro-video',
        passwordHash: 'x',
        emailVerified: true,
      },
      select: { id: true },
    });
    sellerId = seller.id;

    await indexar('con-video', true);
    await indexar('sin-video', false);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Crea un anuncio ACTIVE y lo indexa. `indexListing` ya espera con `waitForTask`. */
  async function indexar(sufijo: string, conVideo: boolean) {
    const creado = await prisma.listing.create({
      data: {
        title: `${MARCA} ${sufijo}`,
        slug: `filtro-video-${sufijo}`,
        description: `Anuncio ${MARCA} para el filtro de vídeo`,
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
        ...(conVideo && { videoUrl: VIDEO_URL, videoDurationSeconds: 30, videoUploadedAt: new Date() }),
      },
      select: { id: true },
    });
    const row = await prisma.listing.findUniqueOrThrow({
      where: { id: creado.id },
      include: INDEX_INCLUDE,
    });
    await search.indexListing(row as never);
    return creado.id;
  }

  async function buscar(query: string) {
    const res = await request(app.getHttpServer()).get(`/api/search?${query}`).expect(200);
    return res.body as { hits: { title: string; hasVideo?: boolean }[]; totalHits: number };
  }

  // ── BARRERA 2 — el ÍNDICE REAL lo acepta ───────────────────────────────────

  it('BARRERA 2 — `hasVideo` es filtrable en el índice REAL, no sólo en la constante', async () => {
    // La constante es una intención; esto es el hecho. Si los settings no se hubieran
    // aplicado (o se hubieran aplicado sin esperar la tarea), filtrar daría
    // «attribute hasVideo is not filterable».
    const index = buildMeiliClient().index(LISTINGS_INDEX);
    const settings = await index.getSettings();

    expect(settings.filterableAttributes).toContain('hasVideo');
  });

  it('y una consulta directa a Meilisearch con ese filtro NO da error', async () => {
    // La comprobación que de verdad importa: que Meili acepte la expresión. Un
    // `filterableAttributes` presente pero a medio aplicar rompería justo aquí.
    const index = buildMeiliClient().index(LISTINGS_INDEX);
    const res = await index.search(MARCA, { filter: 'hasVideo = true' });

    expect(res.hits).toHaveLength(1);
  });

  // ── BARRERA 1 — filtra, y es OPCIONAL ──────────────────────────────────────

  it('BARRERA 1 — con el filtro sólo salen los que tienen vídeo', async () => {
    const res = await buscar(`q=${MARCA}&conVideo=true`);

    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].title).toContain('con-video');
    expect(res.hits[0].hasVideo).toBe(true);
  });

  it('SIN el filtro salen los dos: la búsqueda de siempre no cambia', async () => {
    // Lo que hace que el filtro sea OPCIONAL en el sentido fuerte: no pedirlo tiene que
    // devolver exactamente lo de antes, no una versión acotada por defecto.
    const res = await buscar(`q=${MARCA}`);

    expect(res.hits).toHaveLength(2);
  });

  it('`conVideo=false` NO acota — «con vídeo o sin él» es la búsqueda de siempre', async () => {
    // Un query param llega como CADENA, y `'false'` es una cadena verdadera: sin el
    // `Transform` del DTO esto habría filtrado al revés de lo que pide.
    const res = await buscar(`q=${MARCA}&conVideo=false`);

    expect(res.hits).toHaveLength(2);
  });

  it('y se combina con los demás filtros en AND, como cualquier otro', async () => {
    const conCategoria = await buscar(`q=${MARCA}&conVideo=true&category=moviles`);
    expect(conCategoria.hits).toHaveLength(1);

    // Con una categoría donde no hay ninguno, el AND deja el resultado vacío.
    const otraCategoria = await buscar(`q=${MARCA}&conVideo=true&category=coches`);
    expect(otraCategoria.hits).toHaveLength(0);
  });

  // ── BARRERA 3 — el contrato del booleano, intacto ──────────────────────────

  it('BARRERA 3 — filtrar NO trae la URL del vídeo: sigue siendo sólo el booleano', async () => {
    // Poder filtrar por `hasVideo` no cambia el cero-bytes-de-vídeo-en-listas. El
    // documento indexado nunca llevó la dirección, y este barrido lo vuelve a fijar sobre
    // la respuesta del filtro nuevo.
    const res = await buscar(`q=${MARCA}&conVideo=true`);

    expect(res.hits[0].hasVideo).toBe(true);
    expect(JSON.stringify(res)).not.toContain('listing-videos/');
  });

  it('REQUISITO DE ORO — el anuncio deja de salir cuando se le quita el vídeo', async () => {
    // Cierra el ciclo: el filtro no mira una marca congelada al crear, sino el estado
    // actual del documento. Quitar el vídeo reindexa (VideoService.refrescarSuperficies) y
    // el anuncio sale del resultado.
    const id = await indexar('mutable', true);
    expect((await buscar(`q=${MARCA}&conVideo=true`)).hits).toHaveLength(2);

    await prisma.listing.update({ where: { id }, data: { videoUrl: null } });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id }, include: INDEX_INCLUDE });
    await search.indexListing(row as never);

    expect((await buscar(`q=${MARCA}&conVideo=true`)).hits).toHaveLength(1);
  });
});
