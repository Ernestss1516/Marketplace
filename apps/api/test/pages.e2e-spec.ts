// BLOG — páginas informativas (Post.type = PAGE). El riesgo central es una fuga:
// una PAGE apareciendo donde solo deberían estar los POST (feed, detalle, tag),
// o un POST sirviéndose desde el namespace de páginas. Este archivo prueba el
// inventario de filtros type tan exhaustivamente como la matriz negativa de un
// rol — cada sitio que consulta Post debe respetar el tipo.

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Páginas informativas — Post.type (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let editorToken: string;

  let publishedPostId: string;
  let publishedPostSlug: string;
  let publishedPageId: string;
  let publishedPageSlug: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);

    const [admin, editor] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'pages-admin@example.com',
          name: 'Pages Admin',
          slug: 'pages-admin',
          passwordHash,
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'pages-editor@example.com',
          name: 'Pages Editor',
          slug: 'pages-editor',
          passwordHash,
          emailVerified: true,
          role: 'EDITOR',
        },
      }),
    ]);

    // Fixture POST (published) — used to prove it's absent from /paginas/:slug.
    const post = await prisma.post.create({
      data: {
        type: 'POST',
        title: 'Post Fixture No-Fuga',
        slug: 'post-fixture-no-fuga',
        body: 'Cuerpo de post normal',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        authorId: admin.id,
      },
    });
    publishedPostId = post.id;
    publishedPostSlug = post.slug;

    // Fixture PAGE (published) — deliberately given a tag directly via Prisma
    // (bypassing the UI, which never sets tags for pages) to prove the ?tag=
    // filter can't leak a page into the blog feed even if a PAGE row somehow
    // ends up with tag data.
    const page = await prisma.post.create({
      data: {
        type: 'PAGE',
        title: 'Página Fixture No-Fuga',
        slug: 'pagina-fixture-no-fuga',
        body: '# Términos\n\nContenido legal de prueba.',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        tags: ['no-fuga-tag'],
        authorId: admin.id,
      },
    });
    publishedPageId = page.id;
    publishedPageSlug = page.slug;

    const [adminRes, editorRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'pages-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'pages-editor@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    editorToken = editorRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── NO-FUGA: la PAGE nunca aparece donde solo deberían estar los POST ────────

  it('GET /api/blog (feed) → la PAGE publicada NO aparece', async () => {
    const res = await request(app.getHttpServer()).get('/api/blog?perPage=50').expect(200);
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(publishedPostSlug);
    expect(slugs).not.toContain(publishedPageSlug);
  });

  it('GET /api/blog/:slug de una PAGE → 404 (no se sirve desde /blog/)', async () => {
    await request(app.getHttpServer())
      .get(`/api/blog/${publishedPageSlug}`)
      .expect(404);
  });

  it('GET /api/blog?tag=... → la PAGE con ese tag NO aparece (misma query que el feed)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/blog?tag=no-fuga-tag')
      .expect(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('GET /api/paginas/:slug de un POST → 404 (no se sirve desde /paginas/)', async () => {
    await request(app.getHttpServer())
      .get(`/api/paginas/${publishedPostSlug}`)
      .expect(404);
  });

  // ── Migración: filas sin `type` explícito (como los posts pre-existentes) ────
  // caen en POST por el default del schema, sin backfill — y siguen en el feed.

  it('un Post creado SIN type explícito (simula una fila pre-existente) es POST por defecto y aparece en el feed', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pages-admin@example.com' } });
    const legacyPost = await prisma.post.create({
      data: {
        // type omitido a propósito — @default(POST) del schema debe cubrirlo.
        title: 'Post Legacy Sin Type Explícito',
        slug: 'post-legacy-sin-type',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        authorId: admin.id,
      },
    });
    expect(legacyPost.type).toBe('POST');

    const res = await request(app.getHttpServer()).get('/api/blog?perPage=50').expect(200);
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('post-legacy-sin-type');
  });

  it('POST /api/admin/blog SIN type (caller "crear post" existente, sin cambios) → 201, type=POST', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Sin Type En El Body' })
      .expect(201);
    expect(res.body.type).toBe('POST');
  });

  // ── Positivo: el endpoint público de páginas funciona ────────────────────────

  it('GET /api/paginas → lista solo páginas (la PAGE fixture aparece, el POST no)', async () => {
    const res = await request(app.getHttpServer()).get('/api/paginas?perPage=50').expect(200);
    const slugs = res.body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(publishedPageSlug);
    expect(slugs).not.toContain(publishedPostSlug);
  });

  it('GET /api/paginas/:slug de la PAGE publicada → 200, cuerpo correcto', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/paginas/${publishedPageSlug}`)
      .expect(200);
    expect(res.body.title).toBe('Página Fixture No-Fuga');
    expect(res.body.body).toContain('Términos');
  });

  // ── Positivo: EDITOR gestiona páginas de punta a punta ───────────────────────

  let editorPageId: string;
  let editorPageSlug: string;

  it('EDITOR → POST /api/admin/blog { type: PAGE } → 201, type=PAGE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ type: 'PAGE', title: 'Página Creada Por Editor' })
      .expect(201);

    expect(res.body.type).toBe('PAGE');
    expect(res.body.status).toBe('DRAFT');
    editorPageId = res.body.id;
    editorPageSlug = res.body.slug;
  });

  it('GET /api/admin/blog?type=PAGE → incluye la página del EDITOR, no el post fixture', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/blog?type=PAGE&perPage=50')
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(editorPageId);
    expect(ids).not.toContain(publishedPostId);
  });

  it('EDITOR → PATCH /api/admin/blog/:id (editar página) → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${editorPageId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ body: '# Editado\n\nContenido actualizado.' })
      .expect(200);
    expect(res.body.body).toContain('Editado');
  });

  it('EDITOR → POST /api/admin/blog/:id/publish (publicar página) → 200', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${editorPageId}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(res.body.status).toBe('PUBLISHED');
  });

  it('GET /api/paginas/:slug de la página creada por EDITOR → 200 tras publicar', async () => {
    await request(app.getHttpServer())
      .get(`/api/paginas/${editorPageSlug}`)
      .expect(200);
  });

  // ── type inmutable tras crear ─────────────────────────────────────────────────

  it('PATCH /api/admin/blog/:id { type: POST } sobre una PAGE → 400 (UpdatePostDto no acepta type)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/blog/${editorPageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'POST' })
      .expect(400);
  });

  // ── Permisos: borrado físico ADMIN-only, igual que los posts ─────────────────

  it('EDITOR → DELETE /api/admin/blog/:id sobre una página → 403', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/blog/${editorPageId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(403);
  });

  it('ADMIN → DELETE /api/admin/blog/:id sobre una página → 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/blog/${editorPageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const deleted = await prisma.post.findUnique({ where: { id: editorPageId } });
    expect(deleted).toBeNull();
  });
});
