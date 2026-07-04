import { INestApplication } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex, waitForRemoval } from './helpers/meili';

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;

  let adminToken: string;
  let userToken: string;

  let adminId: string;
  let targetUserId: string;   // USER — goes through suspend/ban/reinstate
  let roleTargetId: string;   // USER — used for role-change tests
  let existingAdminId: string; // ADMIN — used for anti-degradation service-level test
  let sellerId: string;

  let categoryId: string;     // 'moviles' from global seed
  let sharedActiveListingId: string;
  let sharedActiveListingSlug: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await resetMeili(meili);

    // cleanDb only truncates User CASCADE; Category and Setting survive between runs.
    // Delete test-specific categories (created inline in tests with fixed slugs).
    await prisma.category.deleteMany({
      where: {
        slug: {
          in: [
            'deportes-admin-test',
            'borrable-admin-test',
            'con-anuncios-admin-test',
            'con-borrador-admin-test',
            'attr-usage-admin-test',
            'padre-admin-test',
            'hijo-admin-test',
          ],
        },
      },
    });

    // Upsert settings to always start at known defaults regardless of what a previous
    // run left behind (e.g. badWordList modified to ["spam","fraude"]).
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: 'badWordList' },
        create: { key: 'badWordList', value: [] },
        update: { value: [] },
      }),
      prisma.setting.upsert({
        where: { key: 'listingExpiryDays' },
        create: { key: 'listingExpiryDays', value: 60 },
        update: { value: 60 },
      }),
      prisma.setting.upsert({
        where: { key: 'contactRequiresVerification' },
        create: { key: 'contactRequiresVerification', value: true },
        update: { value: true },
      }),
      prisma.setting.upsert({
        where: { key: 'proMonthlyFeaturedQuota' },
        create: { key: 'proMonthlyFeaturedQuota', value: 4 },
        update: { value: 4 },
      }),
    ]);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const hash = (pw: string) => bcrypt.hash(pw, 4);

    const [admin, user, targetUser, roleTarget, extraAdmin, seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'adm-admin@example.com',
          name: 'Admin User',
          slug: 'adm-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'adm-user@example.com',
          name: 'Regular User',
          slug: 'adm-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'adm-target@example.com',
          name: 'Target User',
          slug: 'adm-target',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'adm-roletarget@example.com',
          name: 'Role Target',
          slug: 'adm-roletarget',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'adm-admin2@example.com',
          name: 'Existing Admin',
          slug: 'adm-admin2',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'adm-seller@example.com',
          name: 'Seller Admin',
          slug: 'adm-seller',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      }),
    ]);

    adminId = admin.id;
    targetUserId = targetUser.id;
    roleTargetId = roleTarget.id;
    existingAdminId = extraAdmin.id;
    sellerId = seller.id;
    void user;

    // Shared ACTIVE listing — used for listing list/filter/detail + stats counts
    const sharedListing = await prisma.listing.create({
      data: {
        title: 'iPhone 14 Admin Test',
        slug: 'iphone-14-admin-test',
        description: 'Anuncio compartido para tests admin',
        price: 600,
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
    sharedActiveListingId = sharedListing.id;
    sharedActiveListingSlug = sharedListing.slug;

    const [adminRes, userRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'adm-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'adm-user@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Guards ──────────────────────────────────────────────────────────────────

  it('GET /api/admin/stats sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/stats').expect(401);
  });

  it('GET /api/admin/stats como USER → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /api/admin/listings como USER → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  it('GET /api/admin/stats → 200 con estructura correcta', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('listings');
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('moderation');
    expect(res.body).toHaveProperty('conversations');
    expect(typeof res.body.listings.active).toBe('number');
    expect(typeof res.body.users.total).toBe('number');
    expect(typeof res.body.moderation.reportsPending).toBe('number');
  });

  it('GET /api/admin/stats → counts coherentes con datos de test', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // We have 1 ACTIVE listing in beforeAll
    expect(res.body.listings.active).toBeGreaterThanOrEqual(1);
    // We have 6 users created in beforeAll
    expect(res.body.users.total).toBeGreaterThanOrEqual(6);
    // Search stat: null (Meili catch) or numeric object — both are valid
    if (res.body.search !== null) {
      expect(typeof res.body.search.totalDocuments).toBe('number');
    }
  });

  // ── Listings admin ──────────────────────────────────────────────────────────

  it('GET /api/admin/listings → lista paginada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/listings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.page).toBe(1);
  });

  it('GET /api/admin/listings?status=ACTIVE → solo anuncios ACTIVE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/listings?status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.every((l: { status: string }) => l.status === 'ACTIVE'),
    ).toBe(true);
  });

  it('GET /api/admin/listings?sellerId=xxx → solo anuncios de ese vendedor', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/listings?sellerId=${sellerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.every(
        (l: { seller: { id: string } }) => l.seller.id === sellerId,
      ),
    ).toBe(true);
  });

  it('GET /api/admin/listings/:id → detalle con seller, category y reports', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/listings/${sharedActiveListingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.id).toBe(sharedActiveListingId);
    expect(res.body.seller).toBeDefined();
    expect(res.body.seller.id).toBe(sellerId);
    expect(res.body.category).toBeDefined();
    expect(Array.isArray(res.body.reports)).toBe(true);
  });

  it('PATCH /api/admin/listings/:id/status → PENDING_REVIEW → ACTIVE + AuditLog + indexado en Meili', async () => {
    const pendingListing = await prisma.listing.create({
      data: {
        title: 'Listing Pendiente Admin Status',
        slug: 'listing-pending-admin-status',
        description: 'Anuncio en PENDING_REVIEW para cambiar status desde admin',
        price: 100,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'PENDING_REVIEW',
        categoryId,
        sellerId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/listings/${pendingListing.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE', reason: 'Revisado y aprobado' })
      .expect(200);

    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.expiresAt).not.toBeNull();

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, pendingListing.id);

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: pendingListing.id, action: 'LISTING_STATUS_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect(log!.resourceType).toBe('Listing');
    expect((log!.before as { status: string }).status).toBe('PENDING_REVIEW');
    expect((log!.after as { status: string }).status).toBe('ACTIVE');
  });

  it('PATCH /api/admin/listings/:id/status → ACTIVE → REJECTED + retirado de Meili + AuditLog', async () => {
    // Use a listing that was published via the listing API so it's in Meili
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'adm-seller@example.com', password: 'Test1234!' });
    const sellerToken = loginRes.body.accessToken as string;

    const draftRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Listing Para Desactivar Admin',
        description: 'Anuncio que admin va a cambiar de ACTIVE a REJECTED',
        price: 80,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Sevilla',
        province: 'Sevilla',
        latitude: 37.3886,
        longitude: -5.9823,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${draftRes.body.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/listings/${draftRes.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', reason: 'Contenido no permitido' })
      .expect(200);

    expect(res.body.status).toBe('REJECTED');

    await waitForRemoval(meili, process.env.MEILI_INDEX_NAME!, draftRes.body.id as string);

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: draftRes.body.id as string, action: 'LISTING_STATUS_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log!.before as { status: string }).toMatchObject({ status: 'ACTIVE' });
    expect(log!.after as { status: string; reason: string }).toMatchObject({
      status: 'REJECTED',
      reason: 'Contenido no permitido',
    });
  });

  // ── Users admin ─────────────────────────────────────────────────────────────

  it('GET /api/admin/users → lista paginada de todos los usuarios', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(6);
    expect(res.body.page).toBe(1);
  });

  it('GET /api/admin/users?status=ACTIVE → solo usuarios con status ACTIVE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.every((u: { status: string }) => u.status === 'ACTIVE'),
    ).toBe(true);
  });

  it('GET /api/admin/users?role=USER → solo usuarios con role USER', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?role=USER')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.every((u: { role: string }) => u.role === 'USER'),
    ).toBe(true);
  });

  it('GET /api/admin/users?q=Target → búsqueda por nombre devuelve el usuario correcto', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?q=Target')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.items.some((u: { name: string }) =>
        u.name.toLowerCase().includes('target'),
      ),
    ).toBe(true);
  });

  it('GET /api/admin/users/:id → detalle con listings y reportsReceived', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/users/${targetUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.id).toBe(targetUserId);
    expect(Array.isArray(res.body.listings)).toBe(true);
    expect(Array.isArray(res.body.auditLogs)).toBe(true);
  });

  it('PATCH /api/admin/users/:id/suspend → status SUSPENDED + AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('SUSPENDED');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: targetUserId, action: 'USER_SUSPEND' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect((log!.before as { status: string }).status).toBe('ACTIVE');
    expect((log!.after as { status: string }).status).toBe('SUSPENDED');
  });

  it('PATCH /api/admin/users/:id/ban → status BANNED + AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetUserId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('BANNED');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: targetUserId, action: 'USER_BAN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { status: string }).status).toBe('SUSPENDED');
    expect((log!.after as { status: string }).status).toBe('BANNED');
  });

  it('PATCH /api/admin/users/:id/reinstate → status ACTIVE + AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${targetUserId}/reinstate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('ACTIVE');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: targetUserId, action: 'USER_REINSTATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { status: string }).status).toBe('BANNED');
    expect((log!.after as { status: string }).status).toBe('ACTIVE');
  });

  it('PATCH /api/admin/users/:id/role USER → MODERATOR → 200 + AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${roleTargetId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'MODERATOR' })
      .expect(200);

    expect(res.body.role).toBe('MODERATOR');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: roleTargetId, action: 'USER_ROLE_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { role: string }).role).toBe('USER');
    expect((log!.after as { role: string }).role).toBe('MODERATOR');
  });

  // Anti-degradación CAPA 1 — DTO: @IsIn([USER, MODERATOR]) rechaza ADMIN → 400
  it('PATCH /api/admin/users/:id/role { role: ADMIN } → 400 (DTO rechaza ADMIN como valor destino)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${roleTargetId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  // Anti-degradación CAPA 2 — service: rechaza modificar a un ADMIN existente → 403
  it('PATCH /api/admin/users/:id/role sobre ADMIN existente → 403 (service rechaza tocar a un ADMIN)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${existingAdminId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'MODERATOR' })
      .expect(403);
  });

  // ── Categories admin ────────────────────────────────────────────────────────

  let newCategoryId: string;

  it('GET /api/admin/categories → árbol de categorías con children', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // The seeded 'electronica' category has children
    const electronica = res.body.find((c: { slug: string }) => c.slug === 'electronica');
    expect(electronica).toBeDefined();
    expect(Array.isArray(electronica.children)).toBe(true);
    expect(electronica.children.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/admin/categories → crea categoría + AuditLog CATEGORY_CREATE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Deportes Admin Test', slug: 'deportes-admin-test', order: 99 })
      .expect(201);

    expect(res.body.slug).toBe('deportes-admin-test');
    expect(res.body.id).toBeDefined();
    newCategoryId = res.body.id as string;

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: newCategoryId, action: 'CATEGORY_CREATE' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect((log!.after as { slug: string }).slug).toBe('deportes-admin-test');
  });

  it('PATCH /api/admin/categories/:id → edita nombre + AuditLog CATEGORY_EDIT', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/categories/${newCategoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Deportes y Fitness', order: 10 })
      .expect(200);

    expect(res.body.name).toBe('Deportes y Fitness');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: newCategoryId, action: 'CATEGORY_EDIT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { name: string }).name).toBe('Deportes Admin Test');
    expect((log!.after as { name: string }).name).toBe('Deportes y Fitness');
  });

  it('PATCH /api/admin/categories/reorder → reordena sin confundirse con :id + AuditLog CATEGORY_REORDER', async () => {
    // 'reorder' must match the fixed-path handler, not the :id handler.
    // Verifiable because: a) no 404, b) orders get updated, c) AuditLog action is CATEGORY_REORDER.
    const electronica = await prisma.category.findUniqueOrThrow({ where: { slug: 'electronica' } });

    await request(app.getHttpServer())
      .patch('/api/admin/categories/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ id: electronica.id, order: 5 }] })
      .expect(200);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'CATEGORY_REORDER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.resourceId).toBe('batch');

    // Verify the order was actually persisted
    const updated = await prisma.category.findUniqueOrThrow({ where: { slug: 'electronica' } });
    expect(updated.order).toBe(5);
  });

  it('DELETE /api/admin/categories/:id (sin anuncios ni subcats) → 204 + AuditLog CATEGORY_DELETE', async () => {
    // Create a fresh deletable category in this test
    const catToDelete = await prisma.category.create({
      data: { name: 'Borrable', slug: 'borrable-admin-test', order: 999 },
    });

    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${catToDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const stillExists = await prisma.category.findUnique({ where: { id: catToDelete.id } });
    expect(stillExists).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: catToDelete.id, action: 'CATEGORY_DELETE' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { slug: string }).slug).toBe('borrable-admin-test');
  });

  it('DELETE /api/admin/categories/:id con anuncios ACTIVE → 400', async () => {
    const catWithListings = await prisma.category.create({
      data: { name: 'Con Anuncios', slug: 'con-anuncios-admin-test', order: 998 },
    });
    await prisma.listing.create({
      data: {
        title: 'Anuncio En Categoría',
        slug: 'anuncio-en-categoria-admin-test',
        description: 'Anuncio activo en categoría con anuncios',
        price: 50,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        categoryId: catWithListings.id,
        sellerId,
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/admin/categories/${catWithListings.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.message).toBe('No se puede eliminar: la categoría tiene 1 anuncio(s)');
  });

  // FIX 1 (cierre Fase 5.2): antes, deleteCategory solo contaba anuncios status:ACTIVE.
  // Una categoría con anuncios en otros estados (DRAFT/SOLD/EXPIRED/…) pasaba ese
  // chequeo y el DELETE físico posterior chocaba con la constraint RESTRICT de
  // Listing_categoryId_fkey (cualquier Listing, no solo ACTIVE), produciendo un 500
  // sin controlar. Ahora el count no filtra por status, así que este caso da 400.
  it('DELETE /api/admin/categories/:id con anuncio DRAFT (no ACTIVE) → 400 legible, no 500', async () => {
    const catWithDraftListing = await prisma.category.create({
      data: { name: 'Con Borrador', slug: 'con-borrador-admin-test', order: 996 },
    });
    await prisma.listing.create({
      data: {
        title: 'Anuncio Borrador En Categoría',
        slug: 'anuncio-borrador-categoria-admin-test',
        description: 'Anuncio en DRAFT en categoría sin anuncios activos',
        price: 50,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'DRAFT',
        categoryId: catWithDraftListing.id,
        sellerId,
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/admin/categories/${catWithDraftListing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.message).toBe('No se puede eliminar: la categoría tiene 1 anuncio(s)');

    // La categoría y el anuncio deben seguir existiendo: el 400 bloqueó el DELETE.
    const stillExists = await prisma.category.findUnique({ where: { id: catWithDraftListing.id } });
    expect(stillExists).not.toBeNull();
  });

  it('DELETE /api/admin/categories/:id con subcategorías → 400', async () => {
    const parent = await prisma.category.create({
      data: { name: 'Padre Admin', slug: 'padre-admin-test', order: 997 },
    });
    await prisma.category.create({
      data: { name: 'Hijo Admin', slug: 'hijo-admin-test', order: 1, parentId: parent.id },
    });

    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${parent.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  // FIX 2 (cierre Fase 5.2): endpoint de aviso — cuenta anuncios con datos bajo
  // una key concreta en su JSON attributes, para que el editor pueda avisar antes
  // de renombrar un atributo con datos existentes. No migra nada, solo cuenta.
  it('GET /api/admin/categories/:id/attribute-usage?key=X → cuenta anuncios con esa key en attributes', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Attr Usage Admin Test', slug: 'attr-usage-admin-test', order: 995 },
    });
    await prisma.listing.createMany({
      data: [
        {
          title: 'Anuncio con fuel 1',
          slug: 'anuncio-attr-usage-1-admin-test',
          description: 'Tiene fuel',
          price: 10,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'DRAFT',
          categoryId: cat.id,
          sellerId,
          attributes: { fuel: 'diesel' },
        },
        {
          title: 'Anuncio con fuel 2',
          slug: 'anuncio-attr-usage-2-admin-test',
          description: 'También tiene fuel',
          price: 20,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'ACTIVE',
          categoryId: cat.id,
          sellerId,
          attributes: { fuel: 'gasolina', extra: true },
        },
        {
          title: 'Anuncio sin fuel',
          slug: 'anuncio-attr-usage-3-admin-test',
          description: 'No tiene fuel, tiene combustible',
          price: 30,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'DRAFT',
          categoryId: cat.id,
          sellerId,
          attributes: { combustible: 'diesel' },
        },
      ],
    });

    const fuel = await request(app.getHttpServer())
      .get(`/api/admin/categories/${cat.id}/attribute-usage`)
      .query({ key: 'fuel' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(fuel.body).toEqual({ count: 2 });

    const combustible = await request(app.getHttpServer())
      .get(`/api/admin/categories/${cat.id}/attribute-usage`)
      .query({ key: 'combustible' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(combustible.body).toEqual({ count: 1 });

    const nope = await request(app.getHttpServer())
      .get(`/api/admin/categories/${cat.id}/attribute-usage`)
      .query({ key: 'no-existe' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(nope.body).toEqual({ count: 0 });
  });

  it('GET /api/admin/categories/:id/attribute-usage → 404 si la categoría no existe', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/categories/cat-inexistente-admin-test/attribute-usage')
      .query({ key: 'fuel' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /api/categories (público) sigue funcionando sin auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // The seeded 'electronica' root category must be present
    expect(
      res.body.some((c: { slug: string }) => c.slug === 'electronica'),
    ).toBe(true);
  });

  // ── Settings ─────────────────────────────────────────────────────────────────

  it('GET /api/admin/settings → lista todas las settings', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const keys = res.body.map((s: { key: string }) => s.key);
    expect(keys).toContain('badWordList');
    expect(keys).toContain('listingExpiryDays');
    expect(keys).toContain('contactRequiresVerification');
    expect(keys).toContain('proMonthlyFeaturedQuota');
  });

  it('PATCH /api/admin/settings/badWordList → actualiza + AuditLog SETTING_UPDATE', async () => {
    const newValue = ['spam', 'fraude'];

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/badWordList')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: newValue })
      .expect(200);

    expect(res.body.key).toBe('badWordList');
    expect(res.body.value).toEqual(newValue);

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: 'badWordList', action: 'SETTING_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect(log!.resourceType).toBe('Setting');
    expect((log!.before as { value: unknown }).value).toEqual([]);
    expect((log!.after as { value: unknown }).value).toEqual(newValue);
  });

  it('PATCH /api/admin/settings/listingExpiryDays → actualiza valor numérico', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/listingExpiryDays')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 90 })
      .expect(200);

    expect(res.body.value).toBe(90);
  });

  it('PATCH /api/admin/settings/proMonthlyFeaturedQuota → actualiza cuota mensual de destacados Pro', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/proMonthlyFeaturedQuota')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 6 })
      .expect(200);

    expect(res.body.value).toBe(6);
  });

  it('PATCH /api/admin/settings/clave-no-permitida → 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/clave-no-permitida')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'cualquier-cosa' })
      .expect(400);
  });
});
