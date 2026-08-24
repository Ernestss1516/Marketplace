/**
 * H8 Bloque C1 — tracking de vistas (con protecciones) + endpoints de stats.
 *
 * Diseño aprobado (ver conversación): Listing.viewCount YA existía y se incrementaba
 * en findBySlug (ambos ramales cache hit/miss) — "ingenuo": contaba al dueño, sin dedup,
 * sin granularidad temporal. Este bloque lo SUSTITUYE por POST /listings/:slug/view
 * (auth opcional, dedup Redis 30 min, excluye al dueño) + ListingViewDaily (agregado
 * diario, para la gráfica Pro) + endpoints de lectura de stats (free básico, Pro
 * enriquecido).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, Prisma, PrismaClient, ProductType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { LIKE_RATIO_MIN_VIEWS } from 'src/modules/listings/sample-threshold';

describe('H8.C1 — tracking de vistas + stats (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  let userSeq = 0;

  async function createUser(suffix: string) {
    userSeq += 1;
    const email = `h8c1-${suffix}-${userSeq}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `H8C1 ${suffix}`,
        slug: `h8c1-${suffix}-${userSeq}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    const token = loginRes.body.accessToken as string;
    return { user, token };
  }

  async function createActiveListing(sellerId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `H8C1 listing ${suffix}`,
        slug: `h8c1-listing-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'desc',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  async function makePro(userId: string) {
    const price = await prisma.price.findFirst({ where: { product: { type: ProductType.RECURRING } } });
    if (!price) throw new Error('No se encontró ningún Price RECURRING sembrado (Plan Pro)');
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId: price.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
        gatewaySubscriptionId: `sub_h8c1_${userId}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId: price.id,
        expiresAt: subscription.currentPeriodEnd,
      },
    });
  }

  function postView(slug: string, opts: { token?: string; ua?: string } = {}) {
    let req = request(app.getHttpServer()).post(`/api/listings/${slug}/view`);
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    req = req.set('User-Agent', opts.ua ?? 'jest-visitor-A');
    return req;
  }

  async function getViewCount(listingId: string): Promise<number> {
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    return listing.viewCount;
  }

  // ---------------------------------------------------------------------------
  // Tracking — POST /listings/:slug/view
  // ---------------------------------------------------------------------------

  describe('POST /listings/:slug/view', () => {
    it('visitante anónimo (sin JWT) cuenta → viewCount +1 y ListingViewDaily del día +1', async () => {
      const { user: seller } = await createUser('anon-owner');
      const listing = await createActiveListing(seller.id, 'anon');

      await postView(listing.slug).expect(204);

      expect(await getViewCount(listing.id)).toBe(1);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const daily = await prisma.listingViewDaily.findUnique({
        where: { listingId_date: { listingId: listing.id, date: today } },
      });
      expect(daily?.count).toBe(1);
    });

    it('visitante NO dueño autenticado cuenta → viewCount +1', async () => {
      const { user: seller } = await createUser('nonowner-seller');
      const { token: visitorToken } = await createUser('nonowner-visitor');
      const listing = await createActiveListing(seller.id, 'nonowner');

      await postView(listing.slug, { token: visitorToken }).expect(204);

      expect(await getViewCount(listing.id)).toBe(1);
    });

    it('el DUEÑO viendo su propio anuncio NO cuenta', async () => {
      const { user: seller, token: sellerToken } = await createUser('owner-self');
      const listing = await createActiveListing(seller.id, 'owner-self');

      await postView(listing.slug, { token: sellerToken }).expect(204);

      expect(await getViewCount(listing.id)).toBe(0);
    });

    it('recarga duplicada del mismo visitante en la ventana → NO cuenta el segundo POST', async () => {
      const { user: seller } = await createUser('dedup-owner');
      const listing = await createActiveListing(seller.id, 'dedup');

      await postView(listing.slug, { ua: 'jest-visitor-dedup' }).expect(204);
      await postView(listing.slug, { ua: 'jest-visitor-dedup' }).expect(204);

      expect(await getViewCount(listing.id)).toBe(1);
    });

    it('dos visitantes anónimos distintos (UA distinto) sobre el mismo anuncio → ambos cuentan', async () => {
      const { user: seller } = await createUser('distinct-owner');
      const listing = await createActiveListing(seller.id, 'distinct');

      await postView(listing.slug, { ua: 'jest-visitor-1' }).expect(204);
      await postView(listing.slug, { ua: 'jest-visitor-2' }).expect(204);

      expect(await getViewCount(listing.id)).toBe(2);
    });

    it('anuncio inexistente → 404, sin crear estado', async () => {
      await postView('slug-que-no-existe-h8c1').expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /listings/:slug ya NO incrementa viewCount (sustituido, no duplicado)
  // ---------------------------------------------------------------------------

  describe('GET /listings/:slug', () => {
    it('ya no incrementa Listing.viewCount (eso ahora solo lo hace POST :slug/view)', async () => {
      const { user: seller } = await createUser('findbyslug-owner');
      const listing = await createActiveListing(seller.id, 'findbyslug');

      await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
      await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
      await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);

      expect(await getViewCount(listing.id)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /listings/mine/:id/stats
  // ---------------------------------------------------------------------------

  describe('GET /listings/mine/:id/stats', () => {
    it('sin auth → 401', async () => {
      const { user: seller } = await createUser('stats-noauth-owner');
      const listing = await createActiveListing(seller.id, 'stats-noauth');
      await request(app.getHttpServer()).get(`/api/listings/mine/${listing.id}/stats`).expect(401);
    });

    it('dueño NO-Pro → solo básico (viewCount, favoritesCount), sin dailyViews ni likeRatio', async () => {
      const { user: seller, token: sellerToken } = await createUser('stats-basic-owner');
      const { token: visitorToken } = await createUser('stats-basic-visitor');
      const listing = await createActiveListing(seller.id, 'stats-basic');

      await postView(listing.slug, { token: visitorToken }).expect(204);
      await request(app.getHttpServer())
        .post(`/api/favorites/${listing.id}`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/mine/${listing.id}/stats`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body).toEqual({ viewCount: 1, favoritesCount: 1 });
    });

    it('dueño Pro → enriquecido con dailyViews y likeRatio', async () => {
      const { user: seller, token: sellerToken } = await createUser('stats-pro-owner');
      await makePro(seller.id);
      const { token: visitorToken } = await createUser('stats-pro-visitor');
      const listing = await createActiveListing(seller.id, 'stats-pro');

      await postView(listing.slug, { token: visitorToken }).expect(204);
      await request(app.getHttpServer())
        .post(`/api/favorites/${listing.id}`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/mine/${listing.id}/stats`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.viewCount).toBe(1);
      expect(res.body.favoritesCount).toBe(1);
      // ESTA ASERCIÓN DECÍA `toBe(1)`, es decir: FIJABA el defecto. Con una visita y un
      // me gusta, el panel publicaba «un 100% de quienes lo ven lo guardan en favoritos»
      // —la traducción literal de un único suceso— y este test se aseguraba de que
      // siguiera haciéndolo. Ahora el ratio calla por debajo del mínimo de visitas y los
      // conteos viajan igual, para poder decir cuántas faltan. Ver `sample-threshold.ts`.
      expect(res.body.likeRatio.value).toBeNull();
      expect(res.body.likeRatio.favorites).toBe(1);
      expect(res.body.likeRatio.views).toBe(1);
      expect(res.body.likeRatio.minViews).toBe(LIKE_RATIO_MIN_VIEWS);
      expect(Array.isArray(res.body.dailyViews)).toBe(true);
      expect(res.body.dailyViews).toHaveLength(1);
      expect(res.body.dailyViews[0].count).toBe(1);
    });

    it('con visitas suficientes SÍ se publica el ratio', async () => {
      // La otra mitad de la barrera: el tratamiento de muestra pequeña no puede ser
      // «no enseñarlo nunca». Cruzado el umbral, el número sale.
      const { user: seller, token: sellerToken } = await createUser('stats-ratio-owner');
      await makePro(seller.id);
      const { token: visitorToken } = await createUser('stats-ratio-visitor');
      const listing = await createActiveListing(seller.id, 'stats-ratio');

      await request(app.getHttpServer())
        .post(`/api/favorites/${listing.id}`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .expect(200);
      // Las visitas se ponen directamente: lo que se prueba es la LECTURA del ratio, y
      // dar 40 visitas reales exigiría 40 visitantes distintos por el dedup de trackView.
      await prisma.listing.update({ where: { id: listing.id }, data: { viewCount: 40 } });

      const res = await request(app.getHttpServer())
        .get(`/api/listings/mine/${listing.id}/stats`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.likeRatio.value).toBeCloseTo(1 / 40);
      expect(res.body.likeRatio.views).toBe(40);
    });

    it('NO dueño → 403', async () => {
      const { user: seller } = await createUser('stats-forbidden-owner');
      const { token: strangerToken } = await createUser('stats-forbidden-stranger');
      const listing = await createActiveListing(seller.id, 'stats-forbidden');

      await request(app.getHttpServer())
        .get(`/api/listings/mine/${listing.id}/stats`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /listings/mine/stats/summary
  // ---------------------------------------------------------------------------

  describe('GET /listings/mine/stats/summary', () => {
    it('sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/listings/mine/stats/summary').expect(401);
    });

    it('usuario NO-Pro → 403', async () => {
      const { token } = await createUser('summary-nopro');
      await request(app.getHttpServer())
        .get('/api/listings/mine/stats/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('usuario Pro → agregado de todos sus anuncios (totalViews, totalFavorites, mostViewedListingId)', async () => {
      const { user: seller, token: sellerToken } = await createUser('summary-pro-owner');
      await makePro(seller.id);
      const { token: visitorToken } = await createUser('summary-pro-visitor');

      const listingA = await createActiveListing(seller.id, 'summary-a');
      const listingB = await createActiveListing(seller.id, 'summary-b');

      // Dos visitantes anónimos DISTINTOS (UA distinto) para que cuenten como 2 vistas
      // en B — el mismo usuario autenticado dos veces se dedupería a 1 (correcto).
      await postView(listingA.slug, { ua: 'jest-visitor-summary-1' }).expect(204);
      await postView(listingB.slug, { ua: 'jest-visitor-summary-1' }).expect(204);
      await postView(listingB.slug, { ua: 'jest-visitor-summary-2' }).expect(204);
      await request(app.getHttpServer())
        .post(`/api/favorites/${listingA.id}`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/listings/mine/stats/summary')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.totalViews).toBe(3); // 1 (A) + 2 (B)
      expect(res.body.totalFavorites).toBe(1);
      expect(res.body.mostViewedListingId).toBe(listingB.id);
    });
  });
});
