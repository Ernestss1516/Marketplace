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
  let adminToken: string;
  let sellerUserId: string;
  let buyerUserId: string;
  let secondBuyerUserId: string;
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

    // Segundo comprador — para los tests de Deal (SERVICIO con varios clientes).
    await prisma.user.create({
      data: {
        email: 'buyer2@example.com',
        name: 'Buyer Two Test',
        slug: 'buyer-two-test',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    // BORRADO B2 — destruir un anuncio pasa a ser de ADMIN, así que el test que
    // comprueba que sale del índice necesita uno.
    await prisma.user.create({
      data: {
        email: 'admin-listings@example.com',
        name: 'Admin Listings Test',
        slug: 'admin-listings-test',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });

    const sellerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'seller@example.com', password: 'Test1234!' });
    sellerToken = sellerLoginRes.body.accessToken as string;
    sellerUserId = sellerLoginRes.body.user.id as string;

    const buyerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'Test1234!' });
    buyerToken = buyerLoginRes.body.accessToken as string;
    buyerUserId = buyerLoginRes.body.user.id as string;

    // Un ADMIN entra por su propia puerta (`/auth/admin-login`); el `/login`
    // público lo rechaza a propósito.
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'admin-listings@example.com', password: 'Test1234!' });
    adminToken = adminLoginRes.body.accessToken as string;

    const buyer2LoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer2@example.com', password: 'Test1234!' });
    secondBuyerUserId = buyer2LoginRes.body.user.id as string;

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

  it('POST /api/listings/:id/deals (PRODUCTO, sin comprador) → 201, status SOLD y retirado del índice', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Marcar Vendido'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Wait for the index job from publish to complete before closing the deal
    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const dealRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({})
      .expect(201);

    expect(dealRes.body.listing.status).toBe('SOLD');
    expect(dealRes.body.deal).toBeNull();

    // The indexing worker re-fetches the listing (status=SOLD) and calls removeListing
    await waitForRemoval(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);
  });

  it('POST /api/listings/:id/deals (PRODUCTO, con comprador) → crea Deal y no exige conversación previa', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Con Comprador Registrado'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const dealRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ buyerId: buyerUserId })
      .expect(201);

    expect(dealRes.body.listing.status).toBe('SOLD');
    expect(dealRes.body.deal.buyerId).toBe(buyerUserId);
    expect(dealRes.body.deal.sellerId).toBe(sellerUserId);
    // Sin Conversation previa entre ambos sobre este anuncio → enlazado por el
    // servidor a null, nunca confiado del cliente.
    expect(dealRes.body.deal.conversationId).toBeNull();
  });

  it('POST /api/listings/:id/deals (SERVICIO) → status sigue ACTIVE, admite varios tratos', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ ...draftPayload('Servicio Con Varios Clientes'), type: 'SERVICE', condition: undefined })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const firstDeal = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ buyerId: buyerUserId })
      .expect(201);

    expect(firstDeal.body.listing.status).toBe('ACTIVE');
    expect(firstDeal.body.deal.buyerId).toBe(buyerUserId);

    // Un segundo cliente puede cerrar OTRO trato sobre el mismo anuncio, que
    // sigue ACTIVE — el punto central de la ráfaga.
    const secondDeal = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ buyerId: secondBuyerUserId })
      .expect(201);

    expect(secondDeal.body.listing.status).toBe('ACTIVE');

    const dealsRes = await request(app.getHttpServer())
      .get(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(dealsRes.body).toHaveLength(2);

    // Cleanup — a SERVICE deliberately stays ACTIVE after closeDeal (the whole
    // point of this ráfaga), which would otherwise eat into sellerToken's
    // shared active-listing quota (freeActiveListingLimit=5) for the rest of
    // this file's tests.
    //
    // BORRADO B2 — SE ARCHIVA, no se borra: el dueño ya no puede destruir un
    // anuncio publicado. Sirve exactamente igual para lo que esta limpieza
    // necesita —ARCHIVED es el único estado que NO cuenta para el cupo— y
    // además es el camino que seguiría un vendedor de verdad.
    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/archive`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
  });

  it('POST /api/listings/:id/deals (SERVICIO, sin comprador) → 400', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ ...draftPayload('Servicio Sin Cliente'), type: 'SERVICE', condition: undefined })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({})
      .expect(400);

    // Cleanup — rejected but the listing itself was published (ACTIVE); see
    // note above on the shared active-listing quota. B2: se archiva.
    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/archive`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
  });

  it('POST /api/listings/:id/deals sobre un DRAFT → 400 (guarda de estado)', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Nunca Publicado'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({})
      .expect(400);
  });

  it('DELETE /api/listings/:id/deals/:dealId (PRODUCTO, dentro de 72h) → revierte a ACTIVE', async () => {
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(draftPayload('Anuncio Para Deshacer Trato'))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const dealRes = await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ buyerId: buyerUserId })
      .expect(201);

    const undoRes = await request(app.getHttpServer())
      .delete(`/api/listings/${draftRes.body.id}/deals/${dealRes.body.deal.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(undoRes.body.status).toBe('ACTIVE');

    const dealsAfter = await request(app.getHttpServer())
      .get(`/api/listings/${draftRes.body.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(dealsAfter.body).toHaveLength(0);

    // Cleanup — undo left this PRODUCT back at ACTIVE; see note above on the
    // shared active-listing quota. B2: se archiva.
    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/archive`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
  });

  // BORRADO B2 — ESTE CASO CAMBIA DE CAMINO, NO DE PROPIEDAD.
  //
  // Comprobaba que un anuncio publicado sale del índice al borrarlo, y que lo
  // borraba su dueño con `DELETE /listings/:id`. Eso último ya no existe: el dueño
  // archiva, y destruir es de ADMIN y sólo sobre archivados.
  //
  // La propiedad que importa —que destruir un anuncio lo retira de Meilisearch—
  // sigue afirmándose, y ahora por el camino REAL de producción: publicar →
  // archivar → eliminar. De paso queda pinzado el recorrido de los dos pasos.
  it('archivar + eliminar (staff) → 204 y retirado del índice', async () => {
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

    // Paso 1 — el dueño archiva. Sale del mercado sin destruir nada.
    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/archive`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Paso 2 — el staff elimina. Es la única vía que destruye la fila.
    await request(app.getHttpServer())
      .delete(`/api/admin/listings/${draftRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // El borrado encola un job 'remove'; el worker llama a removeListing.
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
