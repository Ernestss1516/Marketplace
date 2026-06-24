import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Favorites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userToken: string;
  let listingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });

    const user = await prisma.user.create({
      data: {
        email: 'fav-user@example.com',
        name: 'Fav User',
        slug: 'fav-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'fav-user@example.com', password: 'Test1234!' });
    userToken = loginRes.body.accessToken as string;

    const listing = await prisma.listing.create({
      data: {
        title: 'iPhone para favoritos',
        slug: 'iphone-para-favoritos',
        description: 'Descripción del iPhone de prueba',
        price: 500,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        categoryId: category.id,
        sellerId: user.id,
      },
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── auth guard ──────────────────────────────────────────────────────────────

  it('POST /api/favorites/:id sin auth → 401', async () => {
    await request(app.getHttpServer()).post(`/api/favorites/${listingId}`).expect(401);
  });

  it('GET /api/favorites sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/favorites').expect(401);
  });

  it('DELETE /api/favorites/:id sin auth → 401', async () => {
    await request(app.getHttpServer()).delete(`/api/favorites/${listingId}`).expect(401);
  });

  // ── mark favorite ───────────────────────────────────────────────────────────

  it('POST /api/favorites/:id → 200 y devuelve el favorito con el anuncio', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/favorites/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.listingId).toBe(listingId);
    expect(res.body.listing).toBeDefined();
    expect(res.body.listing.id).toBe(listingId);
  });

  // ── list favorites ──────────────────────────────────────────────────────────

  it('GET /api/favorites → 200, total 1, contiene el anuncio marcado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].listing.id).toBe(listingId);
  });

  // ── idempotency: mark twice ─────────────────────────────────────────────────

  it('POST /api/favorites/:id dos veces → 200 ambas, total sigue siendo 1', async () => {
    await request(app.getHttpServer())
      .post(`/api/favorites/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
  });

  // ── unmark favorite ─────────────────────────────────────────────────────────

  it('DELETE /api/favorites/:id → 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/favorites/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);
  });

  it('GET /api/favorites → 200, listado vacío tras desmarcar', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  // ── idempotency: unmark non-existent ────────────────────────────────────────

  it('DELETE /api/favorites/:id no marcado → 204 sin error', async () => {
    await request(app.getHttpServer())
      .delete(`/api/favorites/${listingId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);
  });
});
