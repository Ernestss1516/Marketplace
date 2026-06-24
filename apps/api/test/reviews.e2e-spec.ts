import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Reviews (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let buyerToken: string;
  let sellerToken: string;
  let outsiderToken: string;

  let buyerId: string;
  let sellerId: string;
  let sellerSlug: string;

  let listingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });

    const [buyer, seller, outsider] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'rv-buyer@example.com',
          name: 'RV Buyer',
          slug: 'rv-buyer',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'rv-seller@example.com',
          name: 'RV Seller',
          slug: 'rv-seller',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'rv-outsider@example.com',
          name: 'RV Outsider',
          slug: 'rv-outsider',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
    ]);

    buyerId = buyer.id;
    sellerId = seller.id;
    sellerSlug = seller.slug;
    void outsider; // referenced via token only

    const listing = await prisma.listing.create({
      data: {
        title: 'iPhone para reviews',
        slug: 'iphone-para-reviews',
        description: 'Usado para probar el sistema de valoraciones',
        price: 300,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        categoryId: category.id,
        sellerId: seller.id,
      },
    });
    listingId = listing.id;

    // Conversation between buyer and seller for this listing (elegibility gate)
    await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        lastMessageAt: new Date(),
        messages: { create: { senderId: buyer.id, body: '¿Sigue disponible?' } },
      },
    });

    const [buyerRes, sellerRes, outsiderRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rv-buyer@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rv-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rv-outsider@example.com', password: 'Test1234!' }),
    ]);

    buyerToken = buyerRes.body.accessToken as string;
    sellerToken = sellerRes.body.accessToken as string;
    outsiderToken = outsiderRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── auth guards ─────────────────────────────────────────────────────────────

  it('POST /api/reviews sin auth → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/reviews')
      .send({ rating: 5, listingId, targetId: sellerId })
      .expect(401);
  });

  it('GET /api/reviews/eligibility sin auth → 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .expect(401);
  });

  // ── eligibility: before any review ──────────────────────────────────────────

  it('GET eligibility: comprador CON conversación → canReview true', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.canReview).toBe(true);
    expect(res.body.alreadyReviewed).toBe(false);
  });

  it('GET eligibility: outsider SIN conversación → canReview false', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    expect(res.body.canReview).toBe(false);
    expect(res.body.alreadyReviewed).toBe(false);
  });

  // ── anti-fraude ─────────────────────────────────────────────────────────────

  it('POST /api/reviews autovaloración → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ rating: 5, listingId, targetId: buyerId })
      .expect(400);
  });

  it('POST /api/reviews outsider sin conversación → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ rating: 4, listingId, targetId: sellerId })
      .expect(403);
  });

  // ── crear valoración ─────────────────────────────────────────────────────────

  let buyerReviewId: string;

  it('POST /api/reviews comprador → vendedor → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ rating: 4, comment: 'Muy buen vendedor, trato excelente', listingId, targetId: sellerId })
      .expect(201);

    expect(res.body.rating).toBe(4);
    expect(res.body.comment).toBe('Muy buen vendedor, trato excelente');
    expect(res.body.authorId).toBe(buyerId);
    expect(res.body.targetId).toBe(sellerId);
    expect(res.body.editedAt).toBeNull();
    buyerReviewId = res.body.id as string;
  });

  // ── eligibility: después de valorar ─────────────────────────────────────────

  it('GET eligibility: tras valorar → canReview false, alreadyReviewed true', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.canReview).toBe(false);
    expect(res.body.alreadyReviewed).toBe(true);
  });

  // ── duplicado ────────────────────────────────────────────────────────────────

  it('POST /api/reviews duplicado → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ rating: 5, listingId, targetId: sellerId })
      .expect(409);
  });

  // ── bidireccionalidad: vendedor valora comprador ─────────────────────────────

  let sellerReviewId: string;

  it('POST /api/reviews vendedor → comprador → 201 (bidireccional)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ rating: 5, comment: 'Comprador serio y puntual', listingId, targetId: buyerId })
      .expect(201);

    expect(res.body.authorId).toBe(sellerId);
    expect(res.body.targetId).toBe(buyerId);
    sellerReviewId = res.body.id as string;
  });

  // ── editar dentro del plazo ──────────────────────────────────────────────────

  it('PATCH /api/reviews/:id dentro de 72h → 200 y editedAt seteado', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/reviews/${buyerReviewId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ rating: 5, comment: 'Corregido: fue fantástico' })
      .expect(200);

    expect(res.body.rating).toBe(5);
    expect(res.body.comment).toBe('Corregido: fue fantástico');
    expect(res.body.editedAt).not.toBeNull();
  });

  it('PATCH /api/reviews/:id por no-autor → 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/reviews/${buyerReviewId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ rating: 1 })
      .expect(403);
  });

  // ── fuera del plazo: backdate sellerReview ───────────────────────────────────

  it('PATCH /api/reviews/:id fuera del plazo de 72h → 403', async () => {
    const past = new Date(Date.now() - 73 * 60 * 60 * 1000);
    await prisma.review.update({ where: { id: sellerReviewId }, data: { createdAt: past } });

    await request(app.getHttpServer())
      .patch(`/api/reviews/${sellerReviewId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ rating: 4 })
      .expect(403);
  });

  it('DELETE /api/reviews/:id fuera del plazo de 72h → 403', async () => {
    await request(app.getHttpServer())
      .delete(`/api/reviews/${sellerReviewId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);
  });

  // ── borrar dentro del plazo ──────────────────────────────────────────────────

  it('DELETE /api/reviews/:id dentro de 72h → 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/reviews/${buyerReviewId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(204);
  });

  it('DELETE /api/reviews/:id ya borrada → 404', async () => {
    await request(app.getHttpServer())
      .delete(`/api/reviews/${buyerReviewId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(404);
  });

  // ── GET /users/:slug/reviews + aggregate ─────────────────────────────────────
  // buyerReviewId was deleted; sellerReviewId targets buyerId (not sellerId).
  // Create a fresh review targeting seller directly via Prisma so the aggregate
  // test is isolated from the edit/delete tests above.

  it('GET /api/users/:slug/reviews devuelve aggregate y lista correctos', async () => {
    // Insert 2 reviews for the seller directly so aggregate is predictable
    await prisma.review.createMany({
      data: [
        {
          rating: 5,
          comment: 'Perfecto',
          authorId: buyerId,
          targetId: sellerId,
          listingId,
        },
        {
          rating: 3,
          comment: 'Correcto',
          // seller reviews itself is blocked by DTO; use outsider's DB id
          // We need a different authorId — use the outsider's user id via prisma
          authorId: await prisma.user
            .findUniqueOrThrow({ where: { slug: 'rv-outsider' } })
            .then((u) => u.id),
          targetId: sellerId,
          listingId,
        },
      ],
      skipDuplicates: true,
    });

    const res = await request(app.getHttpServer())
      .get(`/api/users/${sellerSlug}/reviews`)
      .expect(200);

    expect(res.body.count).toBeGreaterThanOrEqual(2);
    expect(typeof res.body.average).toBe('number');
    expect(res.body.average).toBeGreaterThan(0);
    expect(res.body.distribution).toMatchObject({ '1': 0, '2': 0, '4': 0 });
    expect(res.body.distribution['5']).toBeGreaterThanOrEqual(1);
    expect(res.body.distribution['3']).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0]).toHaveProperty('author');
    expect(res.body.items[0].author).toHaveProperty('slug');
  });

  it('GET /api/users/:slug/reviews sin valoraciones → count 0, average null', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/rv-outsider/reviews')
      .expect(200);

    expect(res.body.count).toBe(0);
    expect(res.body.average).toBeNull();
    expect(res.body.items).toHaveLength(0);
  });

  it('GET /api/users/:slug/reviews usuario inexistente → 404', async () => {
    await request(app.getHttpServer())
      .get('/api/users/usuario-que-no-existe-xyz/reviews')
      .expect(404);
  });

  // ── moderación: borrar reseña (solo MODERATOR/ADMIN) ─────────────────────────

  it('DELETE /api/moderation/reviews/:id como USER normal → 403', async () => {
    const review = await prisma.review.findFirst({ where: { targetId: sellerId } });
    if (!review) return; // skip if no reviews exist

    await request(app.getHttpServer())
      .delete(`/api/moderation/reviews/${review.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });
});
