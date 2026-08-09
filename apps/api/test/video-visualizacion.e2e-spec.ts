/**
 * Vídeo Pro, ráfaga 3 — LA VISUALIZACIÓN, por el lado de los datos (e2e).
 *
 * LA PRUEBA CENTRAL, y la razón de que exista este fichero: que la URL del vídeo NUNCA llega
 * a un payload de LISTA. El cero-bytes-en-listas del diseño no descansa en que nadie monte un
 * `<video>` por descuido, sino en que la tarjeta no tenga la dirección: sin ella no hay nada
 * que descargar, y eso se puede AFIRMAR en un test en vez de confiarlo a la disciplina.
 *
 * Lo contrario también se fija: en la FICHA la URL sí viaja, porque es donde el vídeo se ve.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';
import { buildMeiliClient } from './helpers/db';

describe('Vídeo Pro — la visualización: qué llega a cada superficie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let search: SearchService;

  let sellerId: string;
  let sellerToken: string;
  let categoryId: string;

  const VIDEO_URL = `${process.env.S3_PUBLIC_URL}/listing-videos/x/v.mp4`;
  const POSTER_URL = `${process.env.S3_PUBLIC_URL}/uploads/p.jpg`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    search = app.get(SearchService);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const seller = await prisma.user.create({
      data: {
        email: 'video-vis@example.com',
        name: 'Vis',
        slug: 'video-vis',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'video-vis@example.com', password: 'Test1234!' });
    sellerToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function crearAnuncio(suffix: string, conVideo: boolean) {
    return prisma.listing.create({
      data: {
        title: `Vis ${suffix}`,
        slug: `video-vis-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para la visualización del vídeo',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
        ...(conVideo && {
          videoUrl: VIDEO_URL,
          videoPosterUrl: POSTER_URL,
          videoDurationSeconds: 30,
          videoUploadedAt: new Date(),
        }),
      },
      select: { id: true, slug: true },
    });
  }

  // ── 1. Las listas: el booleano sí, la dirección NO ─────────────────────────

  describe('los payloads de LISTA', () => {
    it('llevan hasVideo pero NUNCA la URL del vídeo', async () => {
      const conVideo = await crearAnuncio('lista-con', true);
      const sinVideo = await crearAnuncio('lista-sin', false);

      const res = await request(app.getHttpServer())
        .get('/api/users/me/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const a = res.body.items.find((i: { id: string }) => i.id === conVideo.id);
      const b = res.body.items.find((i: { id: string }) => i.id === sinVideo.id);

      expect(a.hasVideo).toBe(true);
      expect(b.hasVideo).toBe(false);

      // LO QUE DE VERDAD IMPORTA: sin dirección, una tarjeta no puede descargar el vídeo
      // aunque alguien monte un <video> por descuido. La garantía es estructural.
      expect(a.videoUrl).toBeUndefined();
      expect(a.videoPosterUrl).toBeUndefined();
    });

    it('y el payload entero de la lista no contiene la URL por ningún lado', async () => {
      await crearAnuncio('lista-barrido', true);

      const res = await request(app.getHttpServer())
        .get('/api/users/me/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      // Un barrido del JSON completo: si la dirección se colara por cualquier campo nuevo
      // —hoy o dentro de un año— este test lo caza.
      expect(JSON.stringify(res.body)).not.toContain('listing-videos/');
    });
  });

  // ── 2. El documento indexado ───────────────────────────────────────────────

  describe('Meilisearch — de donde salen las tarjetas de búsqueda', () => {
    it('indexa hasVideo, y tampoco ahí viaja la URL', async () => {
      const conVideo = await crearAnuncio('meili-con', true);
      const sinVideo = await crearAnuncio('meili-sin', false);

      // Molde de `rf8-meilisearch`: se indexa con las mismas relaciones que usan el
      // processor y `pnpm reindex`, para que el documento sea el mismo por los tres caminos.
      // `indexListing` espera con `waitForTask`, así que al volver ya es consultable.
      for (const id of [conVideo.id, sinVideo.id]) {
        const row = await prisma.listing.findUniqueOrThrow({ where: { id }, include: INDEX_INCLUDE });
        await search.indexListing(row as never);
      }

      const index = buildMeiliClient().index(process.env.MEILI_INDEX_NAME ?? 'listings_test');
      const docConVideo = await index.getDocument(conVideo.id);
      const docSinVideo = await index.getDocument(sinVideo.id);

      expect(docConVideo.hasVideo).toBe(true);
      expect(docSinVideo.hasVideo).toBe(false);
      // La búsqueda es la lista más visitada: es donde menos puede colarse la dirección.
      expect(JSON.stringify(docConVideo)).not.toContain('listing-videos/');
    });
  });

  // ── 3. La ficha: aquí SÍ ───────────────────────────────────────────────────

  describe('la FICHA', () => {
    it('sirve la URL del vídeo y su póster, que es donde el vídeo se ve', async () => {
      const listing = await crearAnuncio('ficha', true);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      expect(res.body.videoUrl).toBe(VIDEO_URL);
      expect(res.body.videoPosterUrl).toBe(POSTER_URL);
    });

    it('y un anuncio sin vídeo la sirve a null: la ficha sin vídeo no cambia', async () => {
      const listing = await crearAnuncio('ficha-sin', false);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      expect(res.body.videoUrl).toBeNull();
    });
  });

  // ── 4. Requisito de oro ────────────────────────────────────────────────────

  it('REQUISITO DE ORO — un anuncio SIN vídeo sirve exactamente lo de siempre', async () => {
    const listing = await crearAnuncio('oro', false);

    const ficha = await request(app.getHttpServer())
      .get(`/api/listings/${listing.slug}`)
      .expect(200);
    // Las fotos y el resto del payload siguen igual; el vídeo solo añade dos campos nulos.
    expect(ficha.body.images).toBeDefined();
    expect(ficha.body.hasPhone).toBeDefined();

    const mias = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    // La tarjeta sigue trayendo todo lo que traía; el vídeo solo añade un booleano. (No se
    // comprueba `thumbnailUrl` porque estos anuncios de prueba no tienen fotos, y ausente
    // sería lo correcto: comprobarlo aquí mediría el fixture, no el cambio.)
    const card = mias.body.items.find((i: { id: string }) => i.id === listing.id);
    for (const campo of ['id', 'title', 'slug', 'price', 'status', 'categorySlug']) {
      expect(card[campo]).toBeDefined();
    }
    expect(card.hasVideo).toBe(false);
  });
});
