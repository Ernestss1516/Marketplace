import { INestApplication } from '@nestjs/common';
import { Listing, PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex, waitForRemoval } from './helpers/meili';

describe('Listings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;

  let sellerToken: string;
  let buyerToken: string;
  let categoryId: string;

  /**
   * Shared ACTIVE listing — used for read-only assertions (GET /:slug).
   * Tests that mutate state (reserve, sold, delete, patch) create their own listings.
   */
  let sharedListing: Listing;

  /** Factory for a valid draft payload; called after beforeAll sets categoryId. */
  const draftPayload = (title: string) => ({
    title,
    description: 'Teléfono de prueba en excelente estado',
    price: 350,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    // Explicit coordinates prevent the geocoding HTTP call during tests
    latitude: 40.4168,
    longitude: -3.7038,
  });

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
        email: 'seller@example.com',
        name: 'Seller Test',
        slug: 'seller-test',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    await prisma.user.create({
      data: {
        email: 'buyer@example.com',
        name: 'Buyer Test',
        slug: 'buyer-test',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    const sellerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'seller@example.com', password: 'Test1234!' });
    sellerToken = sellerLoginRes.body.accessToken as string;

    const buyerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'Test1234!' });
    buyerToken = buyerLoginRes.body.accessToken as string;

    // Create and publish the shared read-only listing
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('iPhone 15 Pro (shared fixture)'))
      .expect(201);
    sharedListing = draftRes.body as Listing;

    await request(app.getHttpServer())
      .post(`/api/listings/${sharedListing.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, sharedListing.id);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── create draft ────────────────────────────────────────────────────────────

  it('POST /api/listings → 201, status DRAFT y NO indexado en Meilisearch', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Borrador Test'))
      .expect(201);

    expect(res.body.status).toBe('DRAFT');

    // A DRAFT never enqueues an indexing job, so the document must be absent
    await expect(
      meili.index(process.env.MEILI_INDEX_NAME!).getDocument(res.body.id as string),
    ).rejects.toThrow();
  });

  // ── publish ─────────────────────────────────────────────────────────────────

  it('POST /api/listings/:id/publish → 200, status ACTIVE, expiresAt ≈ publishedAt + 60d e indexado en Meili', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Publicar Test'))
      .expect(201);

    const pubRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(pubRes.body.status).toBe('ACTIVE');

    const publishedAt = new Date(pubRes.body.publishedAt as string).getTime();
    const expiresAt = new Date(pubRes.body.expiresAt as string).getTime();
    const diffDays = (expiresAt - publishedAt) / (1_000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(60, 0);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);
  });

  // ── get by slug ─────────────────────────────────────────────────────────────

  it('GET /api/listings/:slug → 200 y ficha pública del anuncio ACTIVE', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/listings/${sharedListing.slug}`)
      .expect(200);

    expect(res.body).toMatchObject({ slug: sharedListing.slug, status: 'ACTIVE' });
  });

  it('GET /api/listings/:slug (no ACTIVE) → 404', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Solo Borrador'))
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/listings/${draftRes.body.slug}`)
      .expect(404);
  });

  // ── patch ───────────────────────────────────────────────────────────────────

  it('PATCH /api/listings/:id (propietario) → 200 y título actualizado', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Editar'))
      .expect(201);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/listings/${draftRes.body.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'Título Editado Correctamente' })
      .expect(200);

    expect(patchRes.body.title).toBe('Título Editado Correctamente');
  });

  it('PATCH /api/listings/:id (otro usuario) → 403', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Propiedad Del Seller'))
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/listings/${draftRes.body.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ title: 'Intento Fallido De Edición' })
      .expect(403);
  });

  // ── lifecycle ────────────────────────────────────────────────────────────────

  it('POST /api/listings/:id/reserve → 200 y status RESERVED', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Reservar'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const reserveRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/reserve`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(reserveRes.body.status).toBe('RESERVED');
  });

  it('POST /api/listings/:id/sold → 200, status SOLD y retirado del índice', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Marcar Vendido'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Wait for the index job from publish to complete before marking sold
    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const soldRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/sold`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(soldRes.body.status).toBe('SOLD');

    // The indexing worker re-fetches the listing (status=SOLD) and calls removeListing
    await waitForRemoval(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);
  });

  it('DELETE /api/listings/:id → 204 y retirado del índice', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Eliminar'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    await request(app.getHttpServer())
      .delete(`/api/listings/${draftRes.body.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(204);

    // DELETE enqueues a 'remove' job; the worker calls removeListing directly
    await waitForRemoval(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);
  });

  it('POST /api/listings/:id/renew (EXPIRED) → 200, status ACTIVE y expiresAt reiniciado ≈ now + 60d', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Renovar'))
      .expect(201);

    // Force EXPIRED state directly in the DB to bypass the cron
    await prisma.listing.update({
      where: { id: draftRes.body.id as string },
      data: {
        status: 'EXPIRED',
        publishedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000),
      },
    });

    const renewRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/renew`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(renewRes.body.status).toBe('ACTIVE');

    const expiresAt = new Date(renewRes.body.expiresAt as string).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + 59 * 24 * 60 * 60 * 1_000);
    expect(expiresAt).toBeLessThan(Date.now() + 61 * 24 * 60 * 60 * 1_000);
  });
});
