// FOOTER NAV — estructura propia (FooterColumn + FooterItem), independiente
// de Post. Cubre: destino discriminado (PAGE/INTERNAL/EXTERNAL) validado en
// el servicio, el precheck de borrado de una página enlazada (molde
// deleteCategory), que despublicar OMITE el ítem del público sin borrarlo, el
// CRUD+reorder de columnas/ítems (molde categories/reorder), y que GET
// /footer devuelve la estructura ya resuelta (href/external).

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Footer nav (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let editorToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);

    await Promise.all([
      prisma.user.create({
        data: {
          email: 'footer-admin@example.com',
          name: 'Footer Admin',
          slug: 'footer-admin',
          passwordHash,
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'footer-editor@example.com',
          name: 'Footer Editor',
          slug: 'footer-editor',
          passwordHash,
          emailVerified: true,
          role: 'EDITOR',
        },
      }),
    ]);

    const [adminRes, editorRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'footer-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'footer-editor@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    editorToken = editorRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createPage(overrides: { title: string; slug: string; status?: 'DRAFT' | 'PUBLISHED' }) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'footer-admin@example.com' } });
    return prisma.post.create({
      data: {
        type: 'PAGE',
        title: overrides.title,
        slug: overrides.slug,
        blocks: [],
        status: overrides.status ?? 'PUBLISHED',
        publishedAt: overrides.status === 'DRAFT' ? null : new Date(),
        authorId: admin.id,
      },
    });
  }

  // ── Permisos ─────────────────────────────────────────────────────────────

  it('GET /api/admin/footer sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/footer').expect(401);
  });

  it('EDITOR (no ADMIN) → POST /api/admin/footer/columns → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/footer/columns')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ name: 'Legal' })
      .expect(403);
  });

  // ── CRUD de columnas ─────────────────────────────────────────────────────

  let columnId: string;

  it('ADMIN → POST /api/admin/footer/columns → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/footer/columns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legal', order: 0 })
      .expect(201);
    expect(res.body.name).toBe('Legal');
    columnId = res.body.id;
  });

  it('PATCH /api/admin/footer/columns/:id → renombra de golpe', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/footer/columns/${columnId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legal y Privacidad' })
      .expect(200);
    expect(res.body.name).toBe('Legal y Privacidad');
  });

  it('PATCH columns/:id con name vacío → columna sin encabezado (null)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/footer/columns/${columnId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '   ' })
      .expect(200);
    expect(res.body.name).toBeNull();

    // Deja el nombre puesto para el resto de la batería.
    await request(app.getHttpServer())
      .patch(`/api/admin/footer/columns/${columnId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legal' })
      .expect(200);
  });

  // ── Destino discriminado de un ítem ──────────────────────────────────────

  it('POST items type=PAGE sin pageId → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Ayuda', type: 'PAGE' })
      .expect(400);
  });

  it('POST items type=INTERNAL con URL absoluta → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Externo', type: 'INTERNAL', url: 'https://example.com' })
      .expect(400);
  });

  it('POST items type=EXTERNAL con ruta relativa → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Buscar', type: 'EXTERNAL', url: '/busqueda' })
      .expect(400);
  });

  it('POST items type=PAGE apuntando a un POST (no PAGE) → 400', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'footer-admin@example.com' } });
    const post = await prisma.post.create({
      data: {
        type: 'POST',
        title: 'Post normal',
        slug: 'post-normal-footer-test',
        blocks: [],
        status: 'PUBLISHED',
        publishedAt: new Date(),
        authorId: admin.id,
      },
    });

    await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Blog inválido', type: 'PAGE', pageId: post.id })
      .expect(400);
  });

  let pageId: string;
  let pageItemId: string;
  let internalItemId: string;
  let externalItemId: string;

  it('POST items con los 3 tipos de destino válidos → 201', async () => {
    const page = await createPage({ title: 'Términos', slug: 'terminos-footer-test' });
    pageId = page.id;

    const pageItem = await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Términos', type: 'PAGE', pageId, order: 0 })
      .expect(201);
    pageItemId = pageItem.body.id;

    const internalItem = await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Buscar', type: 'INTERNAL', url: '/busqueda', order: 1 })
      .expect(201);
    internalItemId = internalItem.body.id;

    const externalItem = await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId, label: 'Nuestro blog externo', type: 'EXTERNAL', url: 'https://example.com/blog', order: 2 })
      .expect(201);
    externalItemId = externalItem.body.id;
  });

  // ── GET /admin/footer — estructura completa con status de página ─────────

  it('GET /api/admin/footer → incluye la columna con sus 3 ítems y el status de la página enlazada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const column = res.body.find((c: { id: string }) => c.id === columnId);
    expect(column).toBeDefined();
    expect(column.items).toHaveLength(3);

    const pageItem = column.items.find((i: { id: string }) => i.id === pageItemId);
    expect(pageItem.page.status).toBe('PUBLISHED');
    expect(pageItem.page.slug).toBe('terminos-footer-test');
  });

  // ── GET /footer (público) — resuelto ──────────────────────────────────────

  it('GET /api/footer → estructura resuelta con href/external, orden por columna e ítem', async () => {
    const res = await request(app.getHttpServer()).get('/api/footer').expect(200);
    const column = res.body.find((c: { name: string }) => c.name === 'Legal');
    expect(column).toBeDefined();
    expect(column.items).toEqual([
      { label: 'Términos', href: '/paginas/terminos-footer-test', external: false },
      { label: 'Buscar', href: '/busqueda', external: false },
      { label: 'Nuestro blog externo', href: 'https://example.com/blog', external: true },
    ]);
  });

  // ── Despublicar la página → el ítem persiste pero se omite del público ───

  it('despublicar la página enlazada → el ítem NO aparece en GET /footer', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/${pageId}/unpublish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/footer').expect(200);
    const column = res.body.find((c: { name: string }) => c.name === 'Legal');
    const labels = column.items.map((i: { label: string }) => i.label);
    expect(labels).not.toContain('Términos');
    expect(labels).toContain('Buscar');
  });

  it('el ítem despublicado SIGUE existiendo en GET /admin/footer, con status DRAFT visible', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const column = res.body.find((c: { id: string }) => c.id === columnId);
    const pageItem = column.items.find((i: { id: string }) => i.id === pageItemId);
    expect(pageItem).toBeDefined();
    expect(pageItem.page.status).toBe('DRAFT');
  });

  it('re-publicar la página → el ítem vuelve a aparecer en GET /footer', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/${pageId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/footer').expect(200);
    const column = res.body.find((c: { name: string }) => c.name === 'Legal');
    const labels = column.items.map((i: { label: string }) => i.label);
    expect(labels).toContain('Términos');
  });

  // ── Borrar la página enlazada → bloqueado ────────────────────────────────

  it('DELETE de la página enlazada desde el footer → 400 con el conteo, no revienta la FK', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/blog/${pageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(res.body.message).toBe('No se puede eliminar: la página está enlazada desde 1 sitio(s) del footer');

    const stillThere = await prisma.post.findUnique({ where: { id: pageId } });
    expect(stillThere).not.toBeNull();
  });

  it('quitar el ítem del footer y luego borrar la página → 204, ahora sí', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/footer/items/${pageItemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/admin/blog/${pageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  // ── Mover de columna (editar columnId) ───────────────────────────────────

  it('PATCH items/:id con un nuevo columnId mueve el ítem sin re-validar el destino', async () => {
    const otherColumn = await request(app.getHttpServer())
      .post('/api/admin/footer/columns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ayuda', order: 1 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/footer/items/${internalItemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId: otherColumn.body.id })
      .expect(200);
    expect(res.body.columnId).toBe(otherColumn.body.id);
  });

  // ── Reorder (molde categories/reorder) ───────────────────────────────────

  it('PATCH /api/admin/footer/columns/reorder → reordena sin confundirse con :id', async () => {
    const columns = await request(app.getHttpServer())
      .get('/api/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const [colA, colB] = columns.body;

    await request(app.getHttpServer())
      .patch('/api/admin/footer/columns/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ id: colA.id, order: colB.order }, { id: colB.id, order: colA.order }] })
      .expect(200);

    const after = await prisma.footerColumn.findUniqueOrThrow({ where: { id: colA.id } });
    expect(after.order).toBe(colB.order);
  });

  it('PATCH /api/admin/footer/items/reorder → reordena ítems dentro de una columna', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/footer/items/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ id: externalItemId, order: 0 }] })
      .expect(200);

    const after = await prisma.footerItem.findUniqueOrThrow({ where: { id: externalItemId } });
    expect(after.order).toBe(0);
  });

  // ── Borrado de columna: cascade explícito a sus ítems ────────────────────

  it('DELETE columns/:id borra la columna y sus ítems (cascade)', async () => {
    const newColumn = await request(app.getHttpServer())
      .post('/api/admin/footer/columns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temporal' })
      .expect(201);

    const item = await request(app.getHttpServer())
      .post('/api/admin/footer/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ columnId: newColumn.body.id, label: 'X', type: 'INTERNAL', url: '/x' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/admin/footer/columns/${newColumn.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const orphanItem = await prisma.footerItem.findUnique({ where: { id: item.body.id } });
    expect(orphanItem).toBeNull();
  });
});
