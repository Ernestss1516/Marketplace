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

    // Reputación RÁFAGA 3 — la elegibilidad ya no mira Conversation, mira Deal.
    // La Conversation se conserva (mensajería sigue funcionando igual) y el
    // Deal se crea CON conversationId — mismo camino real que closeDeal()
    // produce cuando el comprador viene de una conversación real (verified=true).
    const conversation = await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        lastMessageAt: new Date(),
        messages: { create: { senderId: buyer.id, body: '¿Sigue disponible?' } },
      },
    });
    await prisma.deal.create({
      data: {
        listingId: listing.id,
        listingTitle: listing.title,
        sellerId: seller.id,
        buyerId: buyer.id,
        conversationId: conversation.id,
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

  it('GET eligibility: comprador CON Deal verificable → canReview true, wouldBeVerified true', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.canReview).toBe(true);
    expect(res.body.wouldBeVerified).toBe(true);
    expect(res.body.alreadyReviewed).toBe(false);
  });

  it('GET eligibility: outsider SIN Deal → canReview false', async () => {
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

  it('POST /api/reviews outsider sin Deal → 403', async () => {
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
    // Deal con conversationId → verified congelado a true al crear.
    expect(res.body.verified).toBe(true);
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

  // ── moderación: retirar reseña (solo MODERATOR/ADMIN) ────────────────────────

  it('POST /api/moderation/reviews/:id/retire como USER normal → 403', async () => {
    const review = await prisma.review.findFirst({ where: { targetId: sellerId } });
    if (!review) return; // skip if no reviews exist

    await request(app.getHttpServer())
      .post(`/api/moderation/reviews/${review.id}/retire`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'El valorado quiere quitarse una mala valoración' })
      .expect(403);
  });

  // ── H7: la reseña sobrevive al borrado del anuncio ───────────────────────────
  // Decisión de producto: la reputación no debe ser borrable por el vendedor
  // borrando el anuncio. Review.listingId pasa a SetNull (como Entitlement y
  // Transaction) y se conserva un snapshot de listingTitle.

  describe('borrado de anuncio: la reseña sobrevive (H7)', () => {
    const listingTitle = 'iPhone para borrar (H7)';
    let deletableListingId: string;
    let survivorReviewId: string;

    beforeAll(async () => {
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
      const listing = await prisma.listing.create({
        data: {
          title: listingTitle,
          slug: 'iphone-para-borrar-h7',
          description: 'Anuncio que se borrará para probar integridad de reseñas',
          price: 250,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'ACTIVE',
          categoryId: category.id,
          sellerId,
        },
      });
      deletableListingId = listing.id;

      const conversation = await prisma.conversation.create({
        data: {
          listingId: listing.id,
          buyerId,
          sellerId,
          lastMessageAt: new Date(),
          messages: { create: { senderId: buyerId, body: '¿Sigue disponible?' } },
        },
      });
      await prisma.deal.create({
        data: {
          listingId: listing.id,
          listingTitle,
          sellerId,
          buyerId,
          conversationId: conversation.id,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 5, comment: 'Todo perfecto', listingId: deletableListingId, targetId: sellerId })
        .expect(201);

      survivorReviewId = res.body.id as string;
    });

    it('crear reseña copia el título del anuncio en listingTitle', async () => {
      const review = await prisma.review.findUniqueOrThrow({ where: { id: survivorReviewId } });
      expect(review.listingId).toBe(deletableListingId);
      expect(review.listingTitle).toBe(listingTitle);
    });

    it('borrar el anuncio NO borra la reseña: listingId → NULL, listingTitle conservado', async () => {
      const before = await request(app.getHttpServer())
        .get(`/api/users/${sellerSlug}/reviews`)
        .expect(200);
      const countBefore = before.body.count as number;
      const averageBefore = before.body.average as number;

      // BORRADO B2 — se borra por Prisma, no por el endpoint del dueño.
      //
      // Ese endpoint ya no destruye anuncios publicados: el dueño archiva, y
      // eliminar es de ADMIN y sólo sobre archivados. Lo que este caso comprueba
      // no es QUIÉN puede borrar —eso lo cubre `borrado-politica.e2e-spec.ts`—
      // sino qué le pasa a la RESEÑA cuando el anuncio desaparece, que es
      // comportamiento del schema. Montar un admin aquí sólo para llegar al
      // borrado sería arrastrar la política de permisos a una suite de reseñas.
      // Mismo criterio que `borrado-inventario.e2e-spec.ts`.
      await prisma.listing.delete({ where: { id: deletableListingId } });

      const review = await prisma.review.findUnique({ where: { id: survivorReviewId } });
      expect(review).not.toBeNull();
      expect(review!.listingId).toBeNull();
      expect(review!.listingTitle).toBe(listingTitle);

      // El aggregate del vendedor (media, count) no cambia: la reputación se conserva.
      const after = await request(app.getHttpServer())
        .get(`/api/users/${sellerSlug}/reviews`)
        .expect(200);
      expect(after.body.count).toBe(countBefore);
      expect(after.body.average).toBe(averageBefore);
    });

    it('el listado público muestra la reseña huérfana con el snapshot y sin listingId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${sellerSlug}/reviews`)
        .expect(200);

      const orphan = res.body.items.find((r: { id: string }) => r.id === survivorReviewId);
      expect(orphan).toBeDefined();
      expect(orphan.listingId).toBeNull();
      expect(orphan.listingTitle).toBe(listingTitle);
    });

    it('la unicidad (authorId, targetId, listingId) sigue funcionando para anuncios vivos', async () => {
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
      const liveListing = await prisma.listing.create({
        data: {
          title: 'iPhone vivo para unicidad (H7)',
          slug: 'iphone-vivo-unicidad-h7',
          description: 'Anuncio vivo para probar la constraint de unicidad tras el cambio a SetNull',
          price: 200,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'ACTIVE',
          categoryId: category.id,
          sellerId,
        },
      });

      const conversation = await prisma.conversation.create({
        data: {
          listingId: liveListing.id,
          buyerId,
          sellerId,
          lastMessageAt: new Date(),
          messages: { create: { senderId: buyerId, body: '¿Disponible?' } },
        },
      });
      await prisma.deal.create({
        data: {
          listingId: liveListing.id,
          listingTitle: liveListing.title,
          sellerId,
          buyerId,
          conversationId: conversation.id,
        },
      });

      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 4, listingId: liveListing.id, targetId: sellerId })
        .expect(201);

      // Duplicado sobre el mismo anuncio vivo → sigue bloqueado por la constraint,
      // sin interferencia de las filas huérfanas (listingId NULL) creadas arriba.
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 2, listingId: liveListing.id, targetId: sellerId })
        .expect(409);
    });
  });

  // ── Reputación RÁFAGA 3: elegibilidad basada en Deal, verified congelado ────
  describe('Deal reemplaza a Conversation como gate de elegibilidad', () => {
    let d3SellerId: string;
    let d3SellerSlug: string;
    let d3SellerToken: string;
    let d3DeclaredBuyerToken: string;
    let d3DeclaredBuyerId: string;
    let d3VerifiedBuyerToken: string;
    let d3VerifiedBuyerId: string;
    let d3ListingId: string;

    beforeAll(async () => {
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });

      const [seller, declaredBuyer, verifiedBuyer] = await Promise.all([
        prisma.user.create({
          data: {
            email: 'rv3-seller@example.com',
            name: 'RV3 Seller',
            slug: 'rv3-seller',
            passwordHash: await bcrypt.hash('Test1234!', 4),
            emailVerified: true,
          },
        }),
        prisma.user.create({
          data: {
            email: 'rv3-declared@example.com',
            name: 'RV3 Declared',
            slug: 'rv3-declared',
            passwordHash: await bcrypt.hash('Test1234!', 4),
            emailVerified: true,
          },
        }),
        prisma.user.create({
          data: {
            email: 'rv3-verified@example.com',
            name: 'RV3 Verified',
            slug: 'rv3-verified',
            passwordHash: await bcrypt.hash('Test1234!', 4),
            emailVerified: true,
          },
        }),
      ]);
      d3SellerId = seller.id;
      d3SellerSlug = seller.slug;
      d3DeclaredBuyerId = declaredBuyer.id;
      d3VerifiedBuyerId = verifiedBuyer.id;

      const listing = await prisma.listing.create({
        data: {
          title: 'Fontanero RV3',
          slug: 'fontanero-rv3',
          description: 'Prueba Deal↔Review',
          price: 40,
          type: 'SERVICE',
          priceType: 'FIXED',
          status: 'ACTIVE',
          categoryId: category.id,
          sellerId: d3SellerId,
        },
      });
      d3ListingId = listing.id;

      // Trato DECLARADO — Deal SIN conversación (comprador elegido por búsqueda libre).
      await prisma.deal.create({
        data: {
          listingId: listing.id,
          listingTitle: listing.title,
          sellerId: d3SellerId,
          buyerId: d3DeclaredBuyerId,
          conversationId: null,
        },
      });

      // Trato VERIFICABLE — Deal CON conversación real.
      const conversation = await prisma.conversation.create({
        data: {
          listingId: listing.id,
          buyerId: d3VerifiedBuyerId,
          sellerId: d3SellerId,
          lastMessageAt: new Date(),
          messages: { create: { senderId: d3VerifiedBuyerId, body: 'Necesito un fontanero' } },
        },
      });
      await prisma.deal.create({
        data: {
          listingId: listing.id,
          listingTitle: listing.title,
          sellerId: d3SellerId,
          buyerId: d3VerifiedBuyerId,
          conversationId: conversation.id,
        },
      });

      const [sellerRes, declaredRes, verifiedRes] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'rv3-seller@example.com', password: 'Test1234!' }),
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'rv3-declared@example.com', password: 'Test1234!' }),
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'rv3-verified@example.com', password: 'Test1234!' }),
      ]);
      d3SellerToken = sellerRes.body.accessToken as string;
      d3DeclaredBuyerToken = declaredRes.body.accessToken as string;
      d3VerifiedBuyerToken = verifiedRes.body.accessToken as string;
    });

    it('Deal declarado (sin conversación) → canReview true, wouldBeVerified false', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/reviews/eligibility?listingId=${d3ListingId}&targetId=${d3SellerId}`)
        .set('Authorization', `Bearer ${d3DeclaredBuyerToken}`)
        .expect(200);
      expect(res.body.canReview).toBe(true);
      expect(res.body.wouldBeVerified).toBe(false);
    });

    it('solo Conversation SIN Deal → canReview false (el desajuste que cierra esta ráfaga)', async () => {
      // Alguien que solo habló, sin ningún trato — antes de esta ráfaga esto daba true.
      const onlyChatted = await prisma.user.create({
        data: {
          email: 'rv3-onlychat@example.com',
          name: 'RV3 OnlyChat',
          slug: 'rv3-onlychat',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      await prisma.conversation.create({
        data: {
          listingId: d3ListingId,
          buyerId: onlyChatted.id,
          sellerId: d3SellerId,
          lastMessageAt: new Date(),
          messages: { create: { senderId: onlyChatted.id, body: '¿Sigue disponible?' } },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rv3-onlychat@example.com', password: 'Test1234!' });
      const onlyChattedToken = res.body.accessToken as string;

      const elig = await request(app.getHttpServer())
        .get(`/api/reviews/eligibility?listingId=${d3ListingId}&targetId=${d3SellerId}`)
        .set('Authorization', `Bearer ${onlyChattedToken}`)
        .expect(200);
      expect(elig.body.canReview).toBe(false);
    });

    let declaredReviewId: string;

    it('review sobre Deal declarado → verified false', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${d3DeclaredBuyerToken}`)
        .send({ rating: 5, comment: 'Trato cerrado por teléfono', listingId: d3ListingId, targetId: d3SellerId })
        .expect(201);
      expect(res.body.verified).toBe(false);
      declaredReviewId = res.body.id as string;
    });

    it('review sobre Deal verificable → verified true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${d3VerifiedBuyerToken}`)
        .send({ rating: 4, comment: 'Hablamos por el chat primero', listingId: d3ListingId, targetId: d3SellerId })
        .expect(201);
      expect(res.body.verified).toBe(true);
    });

    it('el aggregate del vendedor solo cuenta la verificada; unverifiedCount refleja la otra', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${d3SellerSlug}/reviews`)
        .expect(200);
      expect(res.body.count).toBe(1);
      expect(res.body.average).toBe(4);
      expect(res.body.unverifiedCount).toBe(1);
      expect(res.body.items).toHaveLength(2);
    });

    it('un vendedor que fabrica un Deal declarado consigo mismo (sockpuppet) no sube su media', async () => {
      const sockpuppet = await prisma.user.create({
        data: {
          email: 'rv3-sockpuppet@example.com',
          name: 'RV3 Sockpuppet',
          slug: 'rv3-sockpuppet',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      await prisma.deal.create({
        data: {
          listingId: d3ListingId,
          listingTitle: 'Fontanero RV3',
          sellerId: d3SellerId,
          buyerId: sockpuppet.id,
          conversationId: null, // declarado — nadie verificó que hubo trato real
        },
      });
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rv3-sockpuppet@example.com', password: 'Test1234!' });
      const sockpuppetToken = loginRes.body.accessToken as string;

      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${sockpuppetToken}`)
        .send({ rating: 5, comment: '¡El mejor fontanero del mundo!', listingId: d3ListingId, targetId: d3SellerId })
        .expect(201);

      const after = await request(app.getHttpServer())
        .get(`/api/users/${d3SellerSlug}/reviews`)
        .expect(200);
      // La media sigue en 4 (solo la review verificada cuenta) — el intento de
      // inflarla con un Deal declarado fabricado no tuvo ningún efecto.
      expect(after.body.average).toBe(4);
      expect(after.body.count).toBe(1);
      expect(after.body.unverifiedCount).toBe(2);
    });

    it('repetir el trato con el mismo comprador NO habilita una segunda review (una por par)', async () => {
      // Un segundo Deal declarado con el mismo comprador — el vector que
      // dealId-como-ancla habría abierto.
      await prisma.deal.create({
        data: {
          listingId: d3ListingId,
          listingTitle: 'Fontanero RV3',
          sellerId: d3SellerId,
          buyerId: d3DeclaredBuyerId,
          conversationId: null,
        },
      });
      const elig = await request(app.getHttpServer())
        .get(`/api/reviews/eligibility?listingId=${d3ListingId}&targetId=${d3SellerId}`)
        .set('Authorization', `Bearer ${d3DeclaredBuyerToken}`)
        .expect(200);
      expect(elig.body.canReview).toBe(false);
      expect(elig.body.alreadyReviewed).toBe(true);

      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${d3DeclaredBuyerToken}`)
        .send({ rating: 1, listingId: d3ListingId, targetId: d3SellerId })
        .expect(409);
    });

    it('una review no verificada que luego consigue una Conversation NO se recalcula', async () => {
      // El comprador declarado ahora SÍ conversa con el vendedor — su review
      // ya existente debe seguir false, congelada desde que se creó.
      await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${d3DeclaredBuyerToken}`)
        .send({ listingId: d3ListingId, message: 'Ahora sí, hola' })
        .expect(201);

      const review = await prisma.review.findUniqueOrThrow({ where: { id: declaredReviewId } });
      expect(review.verified).toBe(false);
    });

    it('bidireccional: el vendedor puede valorar al comprador verificado', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Authorization', `Bearer ${d3SellerToken}`)
        .send({ rating: 5, comment: 'Cliente puntual', listingId: d3ListingId, targetId: d3VerifiedBuyerId })
        .expect(201);
      expect(res.body.authorId).toBe(d3SellerId);
      expect(res.body.targetId).toBe(d3VerifiedBuyerId);
      expect(res.body.verified).toBe(true);
    });
  });
});
