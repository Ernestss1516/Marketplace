import { INestApplication } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex, waitForRemoval } from './helpers/meili';

describe('Moderation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;

  let userToken: string;
  let moderatorToken: string;
  let sellerToken: string;

  let moderatorId: string;
  let sellerId: string;
  let buyerId: string;

  let categoryId: string;
  let sharedListingId: string;
  let sharedReviewId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const [regularUser, moderatorUser, seller, buyer] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'mod-user@example.com',
          name: 'Regular User',
          slug: 'mod-regular-user',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'mod-moderator@example.com',
          name: 'Moderator Test',
          slug: 'mod-moderator',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'mod-seller@example.com',
          name: 'Seller Mod',
          slug: 'mod-seller',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'mod-buyer@example.com',
          name: 'Buyer Mod',
          slug: 'mod-buyer',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
    ]);

    moderatorId = moderatorUser.id;
    sellerId = seller.id;
    buyerId = buyer.id;
    void regularUser;

    // Shared ACTIVE listing used for reports and as a base for review
    const sharedListing = await prisma.listing.create({
      data: {
        title: 'Listing Compartido Moderación',
        slug: 'listing-compartido-moderacion',
        description: 'Anuncio base para tests de moderación',
        price: 200,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        categoryId: category.id,
        sellerId: seller.id,
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    sharedListingId = sharedListing.id;

    // Conversation needed for review eligibility
    await prisma.conversation.create({
      data: {
        listingId: sharedListing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        lastMessageAt: new Date(),
        messages: { create: { senderId: buyer.id, body: '¿Disponible?' } },
      },
    });

    // Shared review used for: review report test + review-deletion guard test
    const sharedReview = await prisma.review.create({
      data: {
        rating: 2,
        comment: 'Reseña de prueba para moderación',
        authorId: buyer.id,
        targetId: seller.id,
        listingId: sharedListing.id,
      },
    });
    sharedReviewId = sharedReview.id;

    const [userRes, modRes, sellerRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'mod-user@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'mod-moderator@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'mod-seller@example.com', password: 'Test1234!' }),
    ]);

    userToken = userRes.body.accessToken as string;
    moderatorToken = modRes.body.accessToken as string;
    sellerToken = sellerRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Guards ──────────────────────────────────────────────────────────────────

  it('GET /api/moderation/reports sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/moderation/reports').expect(401);
  });

  it('GET /api/moderation/reports como USER normal → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('POST /api/moderation/reports sin auth → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .send({ reason: 'SPAM', listingId: sharedListingId })
      .expect(401);
  });

  // ── Reports: crear ─────────────────────────────────────────────────────────

  it('POST /api/moderation/reports → reporte de anuncio → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'SPAM', description: 'Anuncio spam detectado', listingId: sharedListingId })
      .expect(201);

    expect(res.body.reason).toBe('SPAM');
    expect(res.body.listingId).toBe(sharedListingId);
    expect(res.body.reviewId).toBeNull();
    expect(res.body.reportedUserId).toBeNull();
    expect(res.body.status).toBe('PENDING');
  });

  it('POST /api/moderation/reports → reporte de usuario → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'FRAUD', reportedUserId: sellerId })
      .expect(201);

    expect(res.body.reportedUserId).toBe(sellerId);
    expect(res.body.listingId).toBeNull();
    expect(res.body.reviewId).toBeNull();
    expect(res.body.status).toBe('PENDING');
  });

  // Critical: reviewId MUST be persisted — this is what the RV.5 bug broke.
  it('POST /api/moderation/reports → reporte de RESEÑA con reviewId → 201 y reviewId guardado en DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'FAKE_REVIEW', description: 'Reseña falsa detectada', reviewId: sharedReviewId })
      .expect(201);

    expect(res.body.reviewId).toBe(sharedReviewId);
    expect(res.body.listingId).toBeNull();
    expect(res.body.reportedUserId).toBeNull();

    // Double-check persistence in DB — the API response alone is not enough
    const dbReport = await prisma.report.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(dbReport.reviewId).toBe(sharedReviewId);
  });

  it('POST /api/moderation/reports sin target (ni listingId, ni userId, ni reviewId) → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'SPAM' })
      .expect(422);
  });

  // ── Reports: listar con filtros ────────────────────────────────────────────

  it('GET /api/moderation/reports → lista paginada de todos los reportes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/moderation/reports')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.perPage).toBeDefined();
  });

  it('GET /api/moderation/reports?status=PENDING → solo reportes en estado PENDING', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/moderation/reports?status=PENDING')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.items.length).toBeGreaterThan(0);
    expect(
      res.body.items.every((r: { status: string }) => r.status === 'PENDING'),
    ).toBe(true);
  });

  it('GET /api/moderation/reports?reason=SPAM → solo reportes con reason SPAM', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/moderation/reports?reason=SPAM')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.every((r: { reason: string }) => r.reason === 'SPAM'),
    ).toBe(true);
  });

  // ── Reports: workflow (start-review → resolve → dismiss) ───────────────────

  let workflowReportId: string;

  it('PATCH /reports/:id/start-review → PENDING → REVIEWING', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'INAPPROPRIATE', listingId: sharedListingId })
      .expect(201);
    workflowReportId = createRes.body.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/api/moderation/reports/${workflowReportId}/start-review`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.status).toBe('REVIEWING');
  });

  it('PATCH /reports/:id/start-review desde REVIEWING → 400', async () => {
    await request(app.getHttpServer())
      .patch(`/api/moderation/reports/${workflowReportId}/start-review`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(400);
  });

  let resolveReportId: string;

  it('PATCH /reports/:id/resolve → RESOLVED + resolvedById + resolvedAt seteados', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'FRAUD', listingId: sharedListingId })
      .expect(201);
    resolveReportId = createRes.body.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/api/moderation/reports/${resolveReportId}/resolve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.status).toBe('RESOLVED');
    expect(res.body.resolvedById).toBe(moderatorId);
    expect(res.body.resolvedAt).not.toBeNull();
  });

  it('PATCH /reports/:id/resolve desde RESOLVED → 400 (ya cerrado)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/moderation/reports/${resolveReportId}/resolve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(400);
  });

  it('PATCH /reports/:id/dismiss → DISMISSED + resolvedById + resolvedAt seteados', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'OTHER', listingId: sharedListingId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/moderation/reports/${createRes.body.id}/dismiss`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.status).toBe('DISMISSED');
    expect(res.body.resolvedById).toBe(moderatorId);
    expect(res.body.resolvedAt).not.toBeNull();
  });

  // ── Listing actions: approve ───────────────────────────────────────────────

  it('POST /moderation/listings/:id/approve → PENDING_REVIEW → ACTIVE + AuditLog', async () => {
    const pendingListing = await prisma.listing.create({
      data: {
        title: 'Listing Pendiente Para Aprobar',
        slug: 'listing-pending-aprobar',
        description: 'Esperando aprobación de moderación',
        price: 100,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'PENDING_REVIEW',
        categoryId,
        sellerId,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${pendingListing.id}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.status).toBe('ACTIVE');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: pendingListing.id, action: 'LISTING_APPROVE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(moderatorId);
    expect(log!.resourceType).toBe('Listing');
    expect((log!.before as { status: string }).status).toBe('PENDING_REVIEW');
    expect((log!.after as { status: string }).status).toBe('ACTIVE');
  });

  it('POST /moderation/listings/:id/approve desde ACTIVE → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/moderation/listings/${sharedListingId}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(400);
  });

  // ── Listing actions: reject ────────────────────────────────────────────────

  it('POST /moderation/listings/:id/reject → PENDING_REVIEW → REJECTED + AuditLog', async () => {
    const pendingListing = await prisma.listing.create({
      data: {
        title: 'Listing Pendiente Para Rechazar',
        slug: 'listing-pending-rechazar',
        description: 'Esperando revisión y rechazo',
        price: 150,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'FAIR',
        status: 'PENDING_REVIEW',
        categoryId,
        sellerId,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${pendingListing.id}/reject`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Contenido inapropiado' })
      .expect(200);

    expect(res.body.status).toBe('REJECTED');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: pendingListing.id, action: 'LISTING_REJECT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(moderatorId);
    expect((log!.before as { status: string }).status).toBe('PENDING_REVIEW');
    expect((log!.after as { status: string }).status).toBe('REJECTED');
  });

  // ── Listing actions: deactivate ────────────────────────────────────────────

  it('POST /moderation/listings/:id/deactivate → ACTIVE → REJECTED + retirado de Meili + AuditLog', async () => {
    // Publish via API so the listing is actually indexed in Meilisearch
    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Listing Para Desactivar',
        description: 'Anuncio ACTIVE que moderación va a desactivar',
        price: 250,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Barcelona',
        province: 'Barcelona',
        latitude: 41.3851,
        longitude: 2.1734,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${draftRes.body.id}/deactivate`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Artículo prohibido detectado' })
      .expect(200);

    expect(res.body.status).toBe('REJECTED');

    await waitForRemoval(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: draftRes.body.id as string, action: 'LISTING_DEACTIVATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(moderatorId);
    expect((log!.before as { status: string }).status).toBe('ACTIVE');
    expect((log!.after as { status: string }).status).toBe('REJECTED');
  });

  // ── Listing actions: restore ────────────────────────────────────────────────

  it('POST /moderation/listings/:id/restore → REJECTED → ACTIVE + indexado en Meili + AuditLog', async () => {
    const rejectedListing = await prisma.listing.create({
      data: {
        title: 'Listing Rechazado Para Restaurar',
        slug: 'listing-rechazado-restaurar',
        description: 'Anuncio rechazado que moderación restaurará',
        price: 300,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'REJECTED',
        categoryId,
        sellerId,
        publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${rejectedListing.id}/restore`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.expiresAt).not.toBeNull();

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, rejectedListing.id);

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: rejectedListing.id, action: 'LISTING_RESTORE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(moderatorId);
    expect((log!.before as { status: string }).status).toBe('REJECTED');
    expect((log!.after as { status: string }).status).toBe('ACTIVE');
  });

  // ── Review deletion ─────────────────────────────────────────────────────────

  it('DELETE /api/moderation/reviews/:id como USER normal → 403', async () => {
    await request(app.getHttpServer())
      .delete(`/api/moderation/reviews/${sharedReviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('DELETE /api/moderation/reviews/:id como MODERATOR → 204 + review borrada de DB + AuditLog REVIEW_DELETE', async () => {
    // Use a fresh listing to avoid the @@unique([authorId, targetId, listingId]) constraint
    const freshListing = await prisma.listing.create({
      data: {
        title: 'Listing Para Reseña Borrable',
        slug: 'listing-resena-borrable',
        description: 'Anuncio auxiliar para test de borrado de reseña',
        price: 50,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        categoryId,
        sellerId,
      },
    });

    const review = await prisma.review.create({
      data: {
        rating: 1,
        comment: 'Reseña que será borrada por el moderador',
        authorId: buyerId,
        targetId: sellerId,
        listingId: freshListing.id,
      },
    });

    await request(app.getHttpServer())
      .delete(`/api/moderation/reviews/${review.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(204);

    // Verify gone from DB
    const deleted = await prisma.review.findUnique({ where: { id: review.id } });
    expect(deleted).toBeNull();

    // Verify AuditLog
    const log = await prisma.auditLog.findFirst({
      where: { resourceId: review.id, action: 'REVIEW_DELETE' },
    });
    expect(log).not.toBeNull();
    expect(log!.resourceType).toBe('Review');
    expect(log!.actorId).toBe(moderatorId);
    expect((log!.before as { rating: number }).rating).toBe(1);
    expect((log!.before as { comment: string }).comment).toBe('Reseña que será borrada por el moderador');
  });

  it('DELETE /api/moderation/reviews/:id inexistente → 404', async () => {
    await request(app.getHttpServer())
      .delete('/api/moderation/reviews/id-que-no-existe')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(404);
  });

  // ── Role boundaries: ADMIN-only endpoints — unchanged, MODERATOR blocked ─────

  it('MODERATOR → GET /admin/stats → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  it('MODERATOR → GET /admin/categories → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/categories')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  it('MODERATOR → GET /admin/settings → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  it('MODERATOR → GET /admin/billing/transactions → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  // ── Role boundaries: opened endpoints (cambio de producto deliberado RR5.1-ext) ──
  // These were 403 in RR5.1 and are now 200 because MODERATOR access was extended.

  it('MODERATOR → GET /admin/listings → 200 [cambio de producto RR5.1-ext]', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/listings')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  it('MODERATOR → GET /admin/listings/:id → 200', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/listings/${sharedListingId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  it('MODERATOR → PATCH /admin/listings/:id/status → 200', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/listings/${sharedListingId}/status`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ status: 'REJECTED', reason: 'Test RR5.1-ext role boundary' })
      .expect(200);
  });

  it('MODERATOR → GET /admin/users → 200 [cambio de producto RR5.1-ext]', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  it('MODERATOR → GET /admin/users/:id → 200', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/users/${sellerId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  it('MODERATOR → PATCH /admin/users/:id/suspend → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${sellerId}/suspend`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    expect(res.body.status).toBe('SUSPENDED');
  });

  it('MODERATOR → PATCH /admin/users/:id/unsuspend → 200 (SUSPENDED → ACTIVE)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${sellerId}/unsuspend`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('MODERATOR → GET /admin/blog → 200 [cambio de producto RR5.1-ext]', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/blog')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  // Track blog post created by MODERATOR for publish/unpublish/delete tests
  let roleBoundaryBlogPostId: string;

  it('MODERATOR → POST /admin/blog → 201 (crear DRAFT)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        title: 'Post RR5.1-ext Role Boundary',
        slug: 'post-rr51-role-boundary',
        body: 'Contenido de prueba para verificar acceso del moderador al blog.',
      })
      .expect(201);
    roleBoundaryBlogPostId = res.body.id as string;
    expect(res.body.status).toBe('DRAFT');
  });

  it('MODERATOR → GET /admin/blog/:id → 200', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/blog/${roleBoundaryBlogPostId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  it('MODERATOR → POST /admin/blog/:id/publish → 200 (DRAFT → PUBLISHED)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${roleBoundaryBlogPostId}/publish`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    expect(res.body.status).toBe('PUBLISHED');
  });

  it('MODERATOR → POST /admin/blog/:id/unpublish → 200 (PUBLISHED → DRAFT)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${roleBoundaryBlogPostId}/unpublish`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    expect(res.body.status).toBe('DRAFT');
  });

  // ── Role boundaries: ADMIN-only actions — MODERATOR must be blocked ───────────

  it('MODERATOR → PATCH /admin/users/:id/ban → 403 (ban permanente: ADMIN-only)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${sellerId}/ban`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  it('MODERATOR → PATCH /admin/users/:id/reinstate → 403 (desbanear BANNED: ADMIN-only)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${sellerId}/reinstate`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  it('MODERATOR → DELETE /admin/blog/:id → 403 (borrado permanente: ADMIN-only)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/blog/${roleBoundaryBlogPostId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  // ── CRÍTICOS: no-escalada de privilegios (deben quedar VERDES siempre) ────────

  it('CRÍTICO: MODERATOR intenta auto-escalada → PATCH /admin/users/:ownId/role {role:ADMIN} → 403', async () => {
    // RolesGuard blocks MODERATOR before the endpoint is reached.
    // Even if the guard were bypassed, the DTO and service have independent layers.
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${moderatorId}/role`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ role: 'ADMIN' })
      .expect(403);
  });

  it('CRÍTICO: MODERATOR intenta cambiar el rol de otro usuario → 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${sellerId}/role`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ role: 'MODERATOR' })
      .expect(403);
  });

  // ── MODERATOR retains full access to /moderation/* ────────────────────────────

  it('MODERATOR → GET /moderation/reports → 200', async () => {
    await request(app.getHttpServer())
      .get('/api/moderation/reports')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });
});
