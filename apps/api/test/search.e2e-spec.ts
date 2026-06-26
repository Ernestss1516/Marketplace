import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';

// Shared draft payload factory — coordinates are fixed to a Madrid point so that
// the geo-proximity test is deterministic and never calls the geocoding provider.
const BASE_LAT = 40.4168;
const BASE_LNG = -3.7038;

function listingPayload(
  title: string,
  price: number,
  categoryId: string,
  overrides: Partial<{
    latitude: number;
    longitude: number;
    city: string;
    province: string;
  }> = {},
) {
  return {
    title,
    description: `Descripción de prueba para "${title}"`,
    price,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: BASE_LAT,
    longitude: BASE_LNG,
    ...overrides,
  };
}

describe('Search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let sellerToken: string;
  let categoryId: string;

  // IDs of the 6 published listings (used to waitForIndex in beforeAll).
  const publishedIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    await prisma.user.create({
      data: {
        email: 'search-seller@example.com',
        name: 'Search Seller',
        slug: 'search-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'search-seller@example.com', password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;

    // Five ACTIVE listings in 'moviles', all with explicit coordinates.
    // Prices are spread so the price-range test can verify both inclusion and
    // exclusion. Five listings fit within the free-plan limit (5 active).
    const listingSpecs = [
      { title: 'iPhone 15 Pro Max Titanio', price: 1_200 },  // above [100, 500] — excluded
      { title: 'Samsung Galaxy S24 Ultra', price: 300 },     // within [100, 500]
      { title: 'Xiaomi 14 Pro Nuevo', price: 150 },          // within [100, 500]
      { title: 'iPhone 14 Seminuevo', price: 400 },          // within [100, 500]
      { title: 'Google Pixel 9 Flamingo', price: 450 },      // within [100, 500]
    ];

    for (const { title, price } of listingSpecs) {
      const draftRes = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload(title, price, categoryId))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/listings/${draftRes.body.id}/publish`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      publishedIds.push(draftRes.body.id as string);
    }

    // DRAFT listing — never published, so never indexed.
    // The distinctive word "Oculto" is absent from all published listings.
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Borrador Oculto No Deberia Aparecer', 99, categoryId))
      .expect(201);

    // Wait until all 5 published listings are visible in Meilisearch.
    // The worker processes jobs asynchronously; waitForIndex polls every 200 ms.
    for (const id of publishedIds) {
      await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── free-text search ────────────────────────────────────────────────────────

  it('GET /api/search?q=titanio → hits que contienen el texto buscado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=titanio')
      .expect(200);

    expect(res.body.hits.length).toBeGreaterThan(0);
    expect(res.body.totalHits).toBeGreaterThan(0);
    // The only listing with "Titanio" in the title should be the first result.
    const titles: string[] = res.body.hits.map((h: { title: string }) => h.title);
    expect(titles.some((t) => /titanio/i.test(t))).toBe(true);
  });

  // ── category filter ─────────────────────────────────────────────────────────

  it('GET /api/search?category=moviles → solo hits de la categoría móviles', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?category=moviles')
      .expect(200);

    expect(res.body.hits.length).toBeGreaterThan(0);
    for (const hit of res.body.hits) {
      expect((hit.categoryPath as string[]).includes('moviles')).toBe(true);
    }
  });

  // ── price-range filter ──────────────────────────────────────────────────────

  it('GET /api/search?minPrice=100&maxPrice=500 → solo hits dentro del rango de precio', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?minPrice=100&maxPrice=500')
      .expect(200);

    expect(res.body.hits.length).toBeGreaterThan(0);
    for (const hit of res.body.hits) {
      expect(hit.price as number).toBeGreaterThanOrEqual(100);
      expect(hit.price as number).toBeLessThanOrEqual(500);
    }
    // Sanity: the listing at 1200 must not appear (filtered out by maxPrice=500).
    const prices: number[] = res.body.hits.map((h: { price: number }) => h.price);
    expect(prices).not.toContain(1_200);
  });

  // ── geo-proximity filter ────────────────────────────────────────────────────
  //
  // All published listings carry explicit coordinates (BASE_LAT, BASE_LNG = Madrid).
  // Searching with radius=1 km around the same point returns them all.
  // Meilisearch's _geoRadius excludes documents without a _geo field, which is
  // the correct behaviour for proximity search.
  // No external geocoding call is made: coordinates are pinned in the DTO.

  it('GET /api/search?lat=40.4168&lng=-3.7038&radius=1 → hits dentro del radio (coordenadas fijas)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/search?lat=${BASE_LAT}&lng=${BASE_LNG}&radius=1`)
      .expect(200);

    expect(res.body.hits.length).toBeGreaterThan(0);
    // Every result must have geo coordinates (Meilisearch only returns geo-tagged docs)
    for (const hit of res.body.hits) {
      expect(hit._geo).toBeDefined();
      expect(hit._geo.lat).toBeCloseTo(BASE_LAT, 2);
      expect(hit._geo.lng).toBeCloseTo(BASE_LNG, 2);
    }
  });

  it('GET /api/search?lat=51.5074&lng=0.1278&radius=1 → 0 hits fuera del radio', async () => {
    // London coordinates — none of our Madrid listings are within 1 km of London.
    const res = await request(app.getHttpServer())
      .get('/api/search?lat=51.5074&lng=0.1278&radius=1')
      .expect(200);

    expect(res.body.hits.length).toBe(0);
  });

  // ── non-ACTIVE listing excluded ─────────────────────────────────────────────

  it('GET /api/search?q=Oculto → anuncio DRAFT no aparece en resultados', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=Oculto')
      .expect(200);

    // "Oculto" is only in the DRAFT title; it was never indexed.
    expect(res.body.totalHits).toBe(0);
    expect(res.body.hits.length).toBe(0);
  });

  // ── pagination ──────────────────────────────────────────────────────────────

  it('Paginación: page=2&hitsPerPage=4 → page 2 con hits reales y ≤ 4 resultados', async () => {
    // 5 published listings total; page 1 returns 4, page 2 returns the remaining 1.
    const res = await request(app.getHttpServer())
      .get('/api/search?page=2&hitsPerPage=4')
      .expect(200);

    expect(res.body.page).toBe(2);
    expect(res.body.hitsPerPage).toBe(4);
    expect(res.body.hits.length).toBeGreaterThan(0);
    expect(res.body.hits.length).toBeLessThanOrEqual(4);
    expect(res.body.totalHits).toBeGreaterThanOrEqual(5);
  });

  // ── facets ──────────────────────────────────────────────────────────────────

  it('Respuesta de búsqueda incluye facetas con distribución de valores', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .expect(200);

    expect(res.body.facets).toBeDefined();
    expect(typeof res.body.facets).toBe('object');
    // At minimum, categorySlug facet must be present (all listings are in 'moviles').
    expect(res.body.facets).toHaveProperty('categorySlug');
    expect(res.body.facets.categorySlug).toHaveProperty('moviles');
  });
});
