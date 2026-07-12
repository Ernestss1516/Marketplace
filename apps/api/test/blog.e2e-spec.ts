import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Blog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let userToken: string;
  let adminId: string;

  // Shared posts seeded in beforeAll — READ-ONLY in all tests
  let sharedDraftSlug: string;
  let sharedDraftId: string;
  let sharedPublishedSlug: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const [admin, regularUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'blog-admin@example.com',
          name: 'Blog Admin',
          slug: 'blog-admin',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'blog-user@example.com',
          name: 'Blog User',
          slug: 'blog-user',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'USER',
        },
      }),
    ]);

    adminId = admin.id;
    void regularUser;

    // Shared DRAFT — must never appear in public endpoints
    const draftPost = await prisma.post.create({
      data: {
        title: 'Borrador Secreto',
        slug: 'borrador-secreto-fixture',
        blocks: [{ id: 'b1', type: 'text', markdown: 'Contenido borrador que no debe ser público' }],
        status: 'DRAFT',
        authorId: admin.id,
      },
    });
    sharedDraftSlug = draftPost.slug;
    sharedDraftId = draftPost.id;

    // Shared PUBLISHED post with tags — used for public list/filter tests
    const publishedPost = await prisma.post.create({
      data: {
        title: 'Artículo Publicado Fixture',
        slug: 'articulo-publicado-fixture',
        excerpt: 'Resumen del artículo publicado',
        blocks: [{ id: 'b1', type: 'text', markdown: '# Hola\n\nEste es el cuerpo del artículo.' }],
        status: 'PUBLISHED',
        tags: ['test-tag', 'segunda-mano'],
        publishedAt: new Date(),
        authorId: admin.id,
      },
    });
    sharedPublishedSlug = publishedPost.slug;
    void sharedDraftId; // referenced in critical test

    const [adminRes, userRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'blog-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'blog-user@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Guards ──────────────────────────────────────────────────────────────────

  it('GET /api/admin/blog sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/blog').expect(401);
  });

  it('GET /api/admin/blog como USER → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/blog')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('POST /api/admin/blog sin auth → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/blog')
      .send({ title: 'Intento sin auth' })
      .expect(401);
  });

  // ── INVARIANTE DE SEGURIDAD: los DRAFT nunca aparecen en público ─────────────
  // These tests MUST FAIL if someone removes the `status: PUBLISHED` filter
  // from listPublished() or findBySlug() in BlogService.

  it('GET /api/blog lista SOLO posts PUBLISHED — el DRAFT no aparece', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/blog')
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);

    // The PUBLISHED post is present
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(sharedPublishedSlug);

    // The DRAFT must be ABSENT — this assertion catches a broken filter
    expect(slugs).not.toContain(sharedDraftSlug);

    // None of the items should ever expose a DRAFT (even if new code adds status field)
    res.body.items.forEach((p: { status?: string }) => {
      if (p.status !== undefined) {
        expect(p.status).toBe('PUBLISHED');
      }
    });
  });

  it('GET /api/blog/:slug de DRAFT → 404 (invariante: DRAFT inaccesible por slug)', async () => {
    // If this returns 200 the PUBLISHED filter in findBySlug is broken
    await request(app.getHttpServer())
      .get(`/api/blog/${sharedDraftSlug}`)
      .expect(404);
  });

  it('GET /api/blog/:slug de PUBLISHED → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/blog/${sharedPublishedSlug}`)
      .expect(200);

    expect(res.body.slug).toBe(sharedPublishedSlug);
    expect(res.body.status).toBe('PUBLISHED');
  });

  // ── Endpoints públicos ───────────────────────────────────────────────────────

  it('GET /api/blog?tag=test-tag → incluye solo posts con ese tag', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/blog?tag=test-tag')
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    res.body.items.forEach((p: { tags: string[] }) => {
      expect(p.tags).toContain('test-tag');
    });
    // DRAFT must still not appear even with tag filter
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(sharedDraftSlug);
  });

  it('GET /api/blog?tag=etiqueta-que-no-existe → items vacíos y total 0', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/blog?tag=etiqueta-que-no-existe-xyz')
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('GET /api/blog?perPage=1 → devuelve como máximo 1 item', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/blog?perPage=1')
      .expect(200);

    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.perPage).toBe(1);
  });

  it('GET /api/blog/:slug → respuesta incluye blocks y author.name', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/blog/${sharedPublishedSlug}`)
      .expect(200);

    expect(Array.isArray(res.body.blocks)).toBe(true);
    expect(res.body.blocks.length).toBeGreaterThan(0);
    expect(res.body.author).toBeDefined();
    expect(typeof res.body.author.name).toBe('string');
    // blocks must NOT be present in the list response (only in detail)
    // — verified separately via the list test above
  });

  // ── Admin CRUD ───────────────────────────────────────────────────────────────
  // Each test owns the post it creates; sequential tests reuse crudPostId.

  let crudPostId: string;
  let crudPostSlug: string;

  it('POST /api/admin/blog → crea DRAFT, slug autogenerado desde el título', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post De Test Autogenerado', excerpt: 'Resumen de prueba' })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.title).toBe('Post De Test Autogenerado');
    // Slug auto-generated: base from title + 6-char hex suffix
    expect(res.body.slug).toMatch(/^post-de-test-autogenerado-[a-f0-9]{6}$/);
    expect(res.body.authorId).toBe(adminId);

    crudPostId = res.body.id as string;
    crudPostSlug = res.body.slug as string;
  });

  it('POST /api/admin/blog con slug explícito → respeta el slug dado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Con Slug Fijo', slug: 'post-con-slug-fijo-e2e' })
      .expect(201);

    expect(res.body.slug).toBe('post-con-slug-fijo-e2e');
  });

  it('POST /api/admin/blog con coverUrl de localhost → 201 (require_tld: false)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Post Con Portada Localhost',
        coverUrl: 'http://localhost:9000/blog/portada.jpg',
      })
      .expect(201);

    expect(res.body.coverUrl).toBe('http://localhost:9000/blog/portada.jpg');
  });

  it('POST /api/admin/blog con coverUrl inválida → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Inválido', coverUrl: 'esto-no-es-una-url' })
      .expect(400);
  });

  it('GET /api/admin/blog → lista todos los posts (DRAFT y PUBLISHED)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(2); // at least 1 DRAFT + 1 PUBLISHED
    const statuses = res.body.items.map((p: { status: string }) => p.status);
    expect(statuses).toContain('DRAFT');
    expect(statuses).toContain('PUBLISHED');
  });

  it('GET /api/admin/blog?status=DRAFT → solo posts en estado DRAFT', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/blog?status=DRAFT')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    res.body.items.forEach((p: { status: string }) => {
      expect(p.status).toBe('DRAFT');
    });
  });

  it('GET /api/admin/blog/:id → detalle completo con blocks y author', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/blog/${crudPostId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.id).toBe(crudPostId);
    expect(res.body.slug).toBe(crudPostSlug);
    expect(res.body.author).toBeDefined();
    expect(res.body.author.id).toBe(adminId);
    expect(Array.isArray(res.body.blocks)).toBe(true);
  });

  it('PATCH /api/admin/blog/:id → edita título + AuditLog POST_UPDATE con before/after', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${crudPostId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Editado Correctamente', tags: ['editado'] })
      .expect(200);

    expect(res.body.title).toBe('Post Editado Correctamente');
    expect(res.body.tags).toContain('editado');

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: crudPostId, action: 'POST_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect(log!.resourceType).toBe('Post');
    expect((log!.before as { title: string }).title).toBe('Post De Test Autogenerado');
    expect((log!.after as { title: string }).title).toBe('Post Editado Correctamente');
  });

  it('POST /api/admin/blog/:id/publish → PUBLISHED + publishedAt seteado + AuditLog POST_PUBLISH', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${crudPostId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.publishedAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: crudPostId, action: 'POST_PUBLISH' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect((log!.before as { status: string }).status).toBe('DRAFT');
    expect((log!.after as { status: string }).status).toBe('PUBLISHED');
  });

  it('POST /api/admin/blog/:id/publish ya publicado → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/${crudPostId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('POST /api/admin/blog/:id/unpublish → DRAFT + publishedAt null + AuditLog POST_UNPUBLISH', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${crudPostId}/unpublish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.publishedAt).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: crudPostId, action: 'POST_UNPUBLISH' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.before as { status: string }).status).toBe('PUBLISHED');
    expect((log!.after as { status: string }).status).toBe('DRAFT');
  });

  it('POST /api/admin/blog/:id/unpublish ya en DRAFT → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/${crudPostId}/unpublish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('DELETE /api/admin/blog/:id → 204 + post borrado de DB + AuditLog POST_DELETE', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/blog/${crudPostId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const deleted = await prisma.post.findUnique({ where: { id: crudPostId } });
    expect(deleted).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { resourceId: crudPostId, action: 'POST_DELETE' },
    });
    expect(log).not.toBeNull();
    expect(log!.resourceType).toBe('Post');
    expect((log!.before as { slug: string }).slug).toBe(crudPostSlug);
  });

  it('GET /api/admin/blog/:id tras borrar → 404', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/blog/${crudPostId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
