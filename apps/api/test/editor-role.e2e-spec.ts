// BLOG — rol EDITOR: batería de seguridad (matriz negativa + positiva).
//
// EDITOR gestiona el blog (contenido reversible: crear/editar/publicar/despublicar)
// y NADA más. Este archivo verifica que las 3 capas de permisos lo excluyen
// coherentemente de todo lo que no es blog:
//   - Capa backend (RolesGuard + @Roles()): matriz negativa de este archivo.
//   - Capa middleware / AdminNav: cubierto en apps/web/e2e/admin-roles.spec.ts.
//
// RolesGuard corta la petición ANTES de llegar al pipe de validación de DTO o al
// servicio, así que los ids de recurso usados en la matriz negativa no necesitan
// existir en BD — el 403 se produce solo por el rol, nunca por lógica de negocio.

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Rol EDITOR (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let editorToken: string;
  let adminToken: string;
  let roleTargetId: string; // USER — usado para el test positivo de asignación de rol EDITOR

  const DUMMY_ID = 'nonexistent-id-00000000';

  // Minimal 1×1 JPEG in memory — no filesystem dependency (mismo fixture que media.e2e-spec.ts).
  const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
    'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
    'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
    'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
    'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
    'base64',
  );

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const [editor, admin, roleTarget] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'editor-role-e2e@example.com',
          name: 'Editor E2E',
          slug: 'editor-role-e2e',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'EDITOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'admin-editor-role-e2e@example.com',
          name: 'Admin Editor Role E2E',
          slug: 'admin-editor-role-e2e',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'role-target-editor-e2e@example.com',
          name: 'Role Target Editor E2E',
          slug: 'role-target-editor-e2e',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'USER',
        },
      }),
    ]);

    roleTargetId = roleTarget.id;
    void editor;

    const [editorRes, adminRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'editor-role-e2e@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'admin-editor-role-e2e@example.com', password: 'Test1234!' }),
    ]);

    editorToken = editorRes.body.accessToken as string;
    adminToken = adminRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Matriz negativa: EDITOR → 403 en todo lo que no es blog ──────────────────

  const NEGATIVE_MATRIX: { method: 'get' | 'post' | 'patch' | 'delete'; path: string; label: string }[] = [
    // admin — dashboard / listings / users
    { method: 'get', path: '/api/admin/stats', label: 'GET /admin/stats' },
    { method: 'get', path: '/api/admin/listings', label: 'GET /admin/listings' },
    { method: 'get', path: `/api/admin/listings/${DUMMY_ID}`, label: 'GET /admin/listings/:id' },
    { method: 'patch', path: `/api/admin/listings/${DUMMY_ID}/status`, label: 'PATCH /admin/listings/:id/status' },
    { method: 'get', path: '/api/admin/users', label: 'GET /admin/users' },
    { method: 'get', path: `/api/admin/users/${DUMMY_ID}`, label: 'GET /admin/users/:id' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/suspend`, label: 'PATCH /admin/users/:id/suspend' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/unsuspend`, label: 'PATCH /admin/users/:id/unsuspend' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/ban`, label: 'PATCH /admin/users/:id/ban' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/reinstate`, label: 'PATCH /admin/users/:id/reinstate' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/role`, label: 'PATCH /admin/users/:id/role' },
    { method: 'patch', path: `/api/admin/users/${DUMMY_ID}/trusted`, label: 'PATCH /admin/users/:id/trusted' },
    // admin — categories
    { method: 'get', path: '/api/admin/categories/searchable-keys', label: 'GET /admin/categories/searchable-keys' },
    { method: 'get', path: '/api/admin/categories', label: 'GET /admin/categories' },
    { method: 'post', path: '/api/admin/categories', label: 'POST /admin/categories' },
    { method: 'patch', path: '/api/admin/categories/reorder', label: 'PATCH /admin/categories/reorder' },
    { method: 'get', path: `/api/admin/categories/${DUMMY_ID}/attribute-usage`, label: 'GET /admin/categories/:id/attribute-usage' },
    { method: 'patch', path: `/api/admin/categories/${DUMMY_ID}`, label: 'PATCH /admin/categories/:id' },
    { method: 'delete', path: `/api/admin/categories/${DUMMY_ID}`, label: 'DELETE /admin/categories/:id' },
    // admin — settings
    { method: 'get', path: '/api/admin/settings', label: 'GET /admin/settings' },
    { method: 'patch', path: '/api/admin/settings/badWordList', label: 'PATCH /admin/settings/:key' },
    // admin — billing
    { method: 'get', path: '/api/admin/billing/transactions', label: 'GET /admin/billing/transactions' },
    { method: 'get', path: '/api/admin/billing/wallets', label: 'GET /admin/billing/wallets' },
    { method: 'get', path: `/api/admin/billing/users/${DUMMY_ID}`, label: 'GET /admin/billing/users/:userId' },
    { method: 'post', path: `/api/admin/billing/users/${DUMMY_ID}/credits`, label: 'POST /admin/billing/users/:userId/credits' },
    // admin — banners
    { method: 'get', path: '/api/admin/banners', label: 'GET /admin/banners' },
    { method: 'post', path: '/api/admin/banners', label: 'POST /admin/banners' },
    { method: 'patch', path: `/api/admin/banners/${DUMMY_ID}`, label: 'PATCH /admin/banners/:id' },
    // admin — coupons
    { method: 'get', path: '/api/admin/coupons', label: 'GET /admin/coupons' },
    { method: 'post', path: '/api/admin/coupons', label: 'POST /admin/coupons' },
    { method: 'patch', path: `/api/admin/coupons/${DUMMY_ID}`, label: 'PATCH /admin/coupons/:id' },
    // admin — campaigns
    { method: 'get', path: '/api/admin/campaigns', label: 'GET /admin/campaigns' },
    { method: 'post', path: '/api/admin/campaigns', label: 'POST /admin/campaigns' },
    { method: 'patch', path: `/api/admin/campaigns/${DUMMY_ID}`, label: 'PATCH /admin/campaigns/:id' },
    // moderation
    { method: 'get', path: '/api/moderation/reports', label: 'GET /moderation/reports' },
    { method: 'get', path: `/api/moderation/reports/${DUMMY_ID}`, label: 'GET /moderation/reports/:id' },
    { method: 'patch', path: `/api/moderation/reports/${DUMMY_ID}/start-review`, label: 'PATCH /moderation/reports/:id/start-review' },
    { method: 'patch', path: `/api/moderation/reports/${DUMMY_ID}/resolve`, label: 'PATCH /moderation/reports/:id/resolve' },
    { method: 'patch', path: `/api/moderation/reports/${DUMMY_ID}/dismiss`, label: 'PATCH /moderation/reports/:id/dismiss' },
    { method: 'post', path: `/api/moderation/listings/${DUMMY_ID}/approve`, label: 'POST /moderation/listings/:id/approve' },
    { method: 'post', path: `/api/moderation/listings/${DUMMY_ID}/reject`, label: 'POST /moderation/listings/:id/reject' },
    { method: 'post', path: `/api/moderation/listings/${DUMMY_ID}/deactivate`, label: 'POST /moderation/listings/:id/deactivate' },
    { method: 'post', path: `/api/moderation/listings/${DUMMY_ID}/restore`, label: 'POST /moderation/listings/:id/restore' },
    { method: 'delete', path: `/api/moderation/reviews/${DUMMY_ID}`, label: 'DELETE /moderation/reviews/:id' },
    // moderation — crear reporte: abierto a USER/MODERATOR/ADMIN, pero NO a EDITOR
    { method: 'post', path: '/api/moderation/reports', label: 'POST /moderation/reports (crear reporte)' },
    // blog — borrado físico: EDITOR gestiona contenido reversible, no irreversible
    { method: 'delete', path: `/api/admin/blog/${DUMMY_ID}`, label: 'DELETE /admin/blog/:id (borrado físico)' },
  ];

  for (const { method, path, label } of NEGATIVE_MATRIX) {
    it(`EDITOR → 403 en ${label}`, async () => {
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({})
        .expect(403);
    });
  }

  // ── Matriz positiva: EDITOR gestiona el blog de punta a punta ────────────────

  let editorPostId: string;

  it('EDITOR → 201 en POST /admin/blog (crear post)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: 'Post creado por EDITOR', excerpt: 'Resumen' })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    editorPostId = res.body.id as string;
  });

  it('EDITOR → 200 en GET /admin/blog (listar)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/blog')
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('EDITOR → 200 en GET /admin/blog/:id (detalle)', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/blog/${editorPostId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
  });

  it('EDITOR → 200 en PATCH /admin/blog/:id (editar)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/blog/${editorPostId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: 'Post editado por EDITOR' })
      .expect(200);

    expect(res.body.title).toBe('Post editado por EDITOR');
  });

  it('EDITOR → 200 en POST /admin/blog/:id/publish (publicar)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${editorPostId}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);

    expect(res.body.status).toBe('PUBLISHED');
  });

  it('EDITOR → 200 en POST /admin/blog/:id/unpublish (despublicar)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/blog/${editorPostId}/unpublish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);

    expect(res.body.status).toBe('DRAFT');
  });

  it('EDITOR → 201 en POST /media/upload (necesita subir imágenes para los posts)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', TINY_JPEG, { filename: 'cover.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body).toHaveProperty('url');
  });

  // ── Asignación del rol: solo ADMIN, DTO acepta EDITOR ────────────────────────

  it('ADMIN → PATCH /admin/users/:id/role { role: EDITOR } → 200 (DTO acepta EDITOR)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${roleTargetId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'EDITOR' })
      .expect(200);

    expect(res.body.role).toBe('EDITOR');
  });

  it('EDITOR → 403 en PATCH /admin/users/:id/role (EDITOR no puede asignar roles)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${roleTargetId}/role`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ role: 'MODERATOR' })
      .expect(403);
  });
});
