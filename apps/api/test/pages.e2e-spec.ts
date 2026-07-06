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

  // ── Slug inmutable mientras una PAGE está PUBLISHED ──────────────────────────

  it('cambiar el slug de una PAGE PUBLISHED → 400 SLUG_IMMUTABLE', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'PAGE', title: 'Página Slug Inmutable', slug: 'pagina-slug-inmutable' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/blog/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: 'pagina-slug-cambiado' })
      .expect(400);
    expect(res.body.code).toBe('SLUG_IMMUTABLE');

    const unchanged = await prisma.post.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(unchanged.slug).toBe('pagina-slug-inmutable');
  });

  it('cambiar el slug de una PAGE en DRAFT → permitido', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'PAGE', title: 'Página Draft Editable', slug: 'pagina-draft-editable' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: 'pagina-draft-editable-v2' })
      .expect(200);
    expect(res.body.slug).toBe('pagina-draft-editable-v2');
  });

  it('cambiar el slug de un POST PUBLISHED → siempre permitido (sin cambio de comportamiento)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Slug Editable', slug: 'post-slug-editable' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/blog/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: 'post-slug-editable-v2' })
      .expect(200);
    expect(res.body.slug).toBe('post-slug-editable-v2');
  });

  // ── showInFooter/footerOrder: rechazo cruzado para POST ──────────────────────

  it('POST /api/admin/blog con showInFooter=true en un POST (sin type, default POST) → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Con Footer Invalido', showInFooter: true })
      .expect(400);
  });

  it('POST /api/admin/blog con footerOrder en un POST → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Con Orden Invalido', footerOrder: 1 })
      .expect(400);
  });

  it('PATCH /api/admin/blog/:id con showInFooter=true sobre un POST existente → 400', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Post Para Rechazo Cruzado' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/blog/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ showInFooter: true })
      .expect(400);
  });

  it('POST /api/admin/blog con showInFooter=true y type=PAGE → 201, aceptado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'PAGE', title: 'Página Con Footer Válido', showInFooter: true, footerOrder: 5 })
      .expect(201);
    expect(res.body.showInFooter).toBe(true);
    expect(res.body.footerOrder).toBe(5);
  });

  // ── GET /paginas/footer — endpoint dedicado, agrupado por footerGroup ────────

  describe('GET /paginas/footer', () => {
    let footerPageAId: string;
    let footerPageBId: string;
    let footerHelpId: string;
    let footerUngroupedId: string;
    let notInFooterPageId: string;
    let draftFooterPageId: string;

    beforeAll(async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pages-admin@example.com' } });

      // Orden deliberadamente invertido/entremezclado en la creación para
      // probar que el ORDER BY es real, no un accidente de inserción.
      // - "Legal": footerOrder 1 y 2 → minOrder 1 → primera columna.
      // - sin grupo (null): footerOrder 3 → columna sin encabezado, entre
      //   Legal (min 1) y Ayuda (min 5) — no desaparece por no tener grupo.
      // - "Ayuda": footerOrder 5 → minOrder 5 → última columna.
      const [pageB, pageA, help, ungrouped, notInFooter, draftFooter] = await Promise.all([
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Footer Página B', slug: 'footer-pagina-b',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 2, footerGroup: 'Legal', authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Footer Página A', slug: 'footer-pagina-a',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 1, footerGroup: 'Legal', authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Footer Página Ayuda', slug: 'footer-pagina-ayuda',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 5, footerGroup: 'Ayuda', authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Footer Página Sin Grupo', slug: 'footer-pagina-sin-grupo',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 3, footerGroup: null, authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Página Publicada Sin Footer', slug: 'pagina-sin-footer',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: false, authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Página Footer En Borrador', slug: 'pagina-footer-borrador',
            status: 'DRAFT', showInFooter: true, footerOrder: 0, footerGroup: 'Legal', authorId: admin.id,
          },
        }),
      ]);
      footerPageAId = pageA.id;
      footerPageBId = pageB.id;
      footerHelpId = help.id;
      footerUngroupedId = ungrouped.id;
      notInFooterPageId = notInFooter.id;
      draftFooterPageId = draftFooter.id;
    });

    it('agrupa en columnas por footerGroup; columnas ordenadas por el footerOrder mínimo del grupo', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const groups = res.body.map((c: { group: string | null }) => c.group);

      // Legal (min 1) < sin-grupo (3) < Ayuda (min 5).
      expect(groups.indexOf('Legal')).toBeLessThan(groups.indexOf(null));
      expect(groups.indexOf(null)).toBeLessThan(groups.indexOf('Ayuda'));
    });

    it('dentro de una columna, las páginas se ordenan por footerOrder asc', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const legal = res.body.find((c: { group: string | null }) => c.group === 'Legal');
      const slugs = legal.pages.map((p: { slug: string }) => p.slug);
      expect(slugs).toEqual(['footer-pagina-a', 'footer-pagina-b']);
    });

    it('footerGroup=null forma su propia columna SIN encabezado — la página no desaparece', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const ungrouped = res.body.find((c: { group: string | null }) => c.group === null);
      expect(ungrouped).toBeDefined();
      expect(ungrouped.pages.map((p: { slug: string }) => p.slug)).toContain('footer-pagina-sin-grupo');
    });

    it('excluye páginas no publicadas o con showInFooter=false de todas las columnas', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const allSlugs = res.body.flatMap((c: { pages: { slug: string }[] }) => c.pages.map((p) => p.slug));
      expect(allSlugs).not.toContain('pagina-sin-footer');
      expect(allSlugs).not.toContain('pagina-footer-borrador');
    });

    it('cada página devuelve solo title+slug (select mínimo)', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const legal = res.body.find((c: { group: string | null }) => c.group === 'Legal');
      const entry = legal.pages.find((p: { slug: string }) => p.slug === 'footer-pagina-a');
      expect(entry).toEqual({ title: 'Footer Página A', slug: 'footer-pagina-a' });
    });

    it('/paginas/footer no se confunde con /paginas/:slug (route ordering correcto)', async () => {
      // Si @Get(':slug') capturara 'footer' antes que @Get('footer'), esto
      // devolvería 404 (findPageBySlug('footer') sin resultado) en vez de un
      // array. Los tests anteriores en este describe ya lo prueban
      // implícitamente (200 + array), pero esta aserción lo deja explícito.
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    afterAll(async () => {
      await prisma.post.deleteMany({
        where: {
          id: {
            in: [footerPageAId, footerPageBId, footerHelpId, footerUngroupedId, notInFooterPageId, draftFooterPageId],
          },
        },
      });
    });
  });

  // ── Desempate de columnas: mismo footerOrder mínimo → alfabético por grupo ───

  describe('GET /paginas/footer — desempate alfabético entre grupos con el mismo minOrder', () => {
    let zetaId: string;
    let alfaId: string;

    beforeAll(async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pages-admin@example.com' } });
      const [zeta, alfa] = await Promise.all([
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Página Zeta', slug: 'pagina-desempate-zeta',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 100, footerGroup: 'Zeta', authorId: admin.id,
          },
        }),
        prisma.post.create({
          data: {
            type: 'PAGE', title: 'Página Alfa', slug: 'pagina-desempate-alfa',
            status: 'PUBLISHED', publishedAt: new Date(),
            showInFooter: true, footerOrder: 100, footerGroup: 'Alfa', authorId: admin.id,
          },
        }),
      ]);
      zetaId = zeta.id;
      alfaId = alfa.id;
    });

    it('"Alfa" aparece antes que "Zeta" cuando ambos grupos tienen el mismo footerOrder mínimo', async () => {
      const res = await request(app.getHttpServer()).get('/api/paginas/footer').expect(200);
      const groups = res.body.map((c: { group: string | null }) => c.group);
      expect(groups.indexOf('Alfa')).toBeLessThan(groups.indexOf('Zeta'));
    });

    afterAll(async () => {
      await prisma.post.deleteMany({ where: { id: { in: [zetaId, alfaId] } } });
    });
  });

  // ── footerGroup: validación solo-PAGE, trim, y sugerencias de admin ──────────

  describe('footerGroup — validación, trim y GET /admin/blog/footer-groups', () => {
    it('POST /api/admin/blog con footerGroup en un POST (type default) → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Post Con Grupo Invalido', footerGroup: 'Legal' })
        .expect(400);
    });

    it('PATCH sobre un POST existente con footerGroup → 400', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Post Para Rechazo De Grupo' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/blog/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ footerGroup: 'Legal' })
        .expect(400);
    });

    it('POST con type=PAGE y footerGroup con espacios → se guarda con trim aplicado', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'PAGE', title: 'Página Con Grupo Con Espacios', footerGroup: '  Legal  ' })
        .expect(201);
      expect(res.body.footerGroup).toBe('Legal');
    });

    it('POST con type=PAGE y footerGroup en blanco → se guarda como null (blank → undefined en el DTO)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'PAGE', title: 'Página Con Grupo En Blanco', footerGroup: '   ' })
        .expect(201);
      expect(res.body.footerGroup).toBeNull();
    });

    it('GET /api/admin/blog/footer-groups → devuelve los valores distintos existentes', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'PAGE', title: 'Página Grupo Nuevo Sugerencia', footerGroup: 'GrupoNuevoSugerencia' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/blog/footer-groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toContain('GrupoNuevoSugerencia');
      expect(res.body).toContain('Legal');
      // Sin duplicados: 'Legal' aparece en múltiples páginas de fixtures previos.
      expect(res.body.filter((g: string) => g === 'Legal')).toHaveLength(1);
    });

    it('GET /api/admin/blog/footer-groups sin token → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/blog/footer-groups').expect(401);
    });

    it('/admin/blog/footer-groups no se confunde con /admin/blog/:id (route ordering correcto)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/blog/footer-groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
