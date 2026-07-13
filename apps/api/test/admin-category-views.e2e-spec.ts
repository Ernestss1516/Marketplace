/**
 * BÚSQUEDA — RÁFAGA 2 (vistas configurables por categoría): validación de
 * escritura de allowedViews/defaultView y del tope de wideCardAttribute, más
 * la resolución efectiva (herencia) expuesta por GET /categories/:slug.
 *
 * Mismo patrón que admin-category-type-policy.e2e-spec.ts: los endpoints de
 * admin leen Category directamente vía Prisma, así que las categorías se
 * crean libremente dentro de cada test.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('Admin — vistas configurables por categoría + wideCardAttribute (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const hash = (pw: string) => bcrypt.hash(pw, 4);
    await prisma.user.upsert({
      where: { email: 'acv-admin@example.com' },
      create: {
        email: 'acv-admin@example.com', name: 'ACV Admin', slug: 'acv-admin',
        passwordHash: await hash('Test1234!'), emailVerified: true, role: 'ADMIN',
      },
      update: {},
    });

    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'acv-admin@example.com', password: 'Test1234!' });
    adminToken = adminRes.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let seq = 0;
  function uniqueSlug(prefix: string) {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  function createCategory(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function updateCategory(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  // ── Guards de escritura ──────────────────────────────────────────────────

  it('crear con allowedViews=[] y defaultView presente → 400 (no puede haber default sin vistas permitidas)', async () => {
    await createCategory({
      name: 'ACV Sin Vistas', slug: uniqueSlug('acv-sin-vistas'),
      allowedViews: [], defaultView: 'MAPA',
    }).expect(400);
  });

  it('crear con defaultView fuera de allowedViews → 400', async () => {
    await createCategory({
      name: 'ACV Default Fuera', slug: uniqueSlug('acv-default-fuera'),
      allowedViews: ['LISTA', 'MAPA'], defaultView: 'AMPLIADA',
    }).expect(400);
  });

  it('crear con allowedViews válido + defaultView incluido → 201', async () => {
    const res = await createCategory({
      name: 'ACV Válida', slug: uniqueSlug('acv-valida'),
      allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA',
    }).expect(201);
    expect(res.body.allowedViews).toEqual(['LISTA', 'MAPA']);
    expect(res.body.defaultView).toBe('MAPA');
  });

  it('crear sin tocar allowedViews/defaultView → se guarda [] / null (sin config, hereda/default global)', async () => {
    const res = await createCategory({
      name: 'ACV Sin Config', slug: uniqueSlug('acv-sin-config'),
    }).expect(201);
    expect(res.body.allowedViews).toEqual([]);
    expect(res.body.defaultView).toBeNull();
  });

  it('editar solo defaultView (sin tocar allowedViews) valida contra el allowedViews ya persistido', async () => {
    const cat = await createCategory({
      name: 'ACV Edit Default', slug: uniqueSlug('acv-edit-default'),
      allowedViews: ['LISTA', 'AMPLIADA'], defaultView: 'LISTA',
    }).expect(201);

    // AMPLIADA sí está en el allowedViews ya persistido → OK
    await updateCategory(cat.body.id, { defaultView: 'AMPLIADA' }).expect(200);
    // MAPA no está → 400
    await updateCategory(cat.body.id, { defaultView: 'MAPA' }).expect(400);
  });

  it('editar solo allowedViews (sin tocar defaultView) valida contra el defaultView ya persistido', async () => {
    const cat = await createCategory({
      name: 'ACV Edit Allowed', slug: uniqueSlug('acv-edit-allowed'),
      allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA',
    }).expect(201);

    // Quitar MAPA de allowedViews deja el defaultView='MAPA' persistido fuera de la lista → 400
    await updateCategory(cat.body.id, { allowedViews: ['LISTA', 'AMPLIADA'] }).expect(400);
    // Incluyendo MAPA sigue siendo válido → 200
    await updateCategory(cat.body.id, { allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'] }).expect(200);
  });

  it('editar allowedViews a [] limpia también el defaultView (vuelve a "no configurado")', async () => {
    const cat = await createCategory({
      name: 'ACV Revert', slug: uniqueSlug('acv-revert'),
      allowedViews: ['MAPA'], defaultView: 'MAPA',
    }).expect(201);

    const res = await updateCategory(cat.body.id, { allowedViews: [] }).expect(200);
    expect(res.body.allowedViews).toEqual([]);
    expect(res.body.defaultView).toBeNull();
  });

  // ── wideCardAttribute — tope de 6 ────────────────────────────────────────

  function attr(name: string, wide = true) {
    return { name, label: name, type: 'text', filterable: false, required: false, ...(wide ? { wideCardAttribute: true } : {}) };
  }

  it('7 atributos con wideCardAttribute:true en el schema efectivo → 400', async () => {
    const attrs = Array.from({ length: 7 }, (_, i) => attr(`w${i}`));
    await createCategory({
      name: 'ACV Wide Overflow', slug: uniqueSlug('acv-wide-overflow'),
      attributeSchema: attrs,
    }).expect(400);
  });

  it('exactamente 6 atributos con wideCardAttribute:true → 201', async () => {
    const attrs = Array.from({ length: 6 }, (_, i) => attr(`v${i}`));
    await createCategory({
      name: 'ACV Wide OK', slug: uniqueSlug('acv-wide-ok'),
      attributeSchema: attrs,
    }).expect(201);
  });

  it('el tope de wideCardAttribute (6) es independiente del de cardAttribute (2): 2 cardAttribute + 6 wideCardAttribute distintos → 201', async () => {
    const cardAttrs = [
      { name: 'c0', label: 'c0', type: 'text', filterable: false, required: false, cardAttribute: true },
      { name: 'c1', label: 'c1', type: 'text', filterable: false, required: false, cardAttribute: true },
    ];
    const wideAttrs = Array.from({ length: 6 }, (_, i) => attr(`w2-${i}`));
    await createCategory({
      name: 'ACV Both Caps', slug: uniqueSlug('acv-both-caps'),
      attributeSchema: [...cardAttrs, ...wideAttrs],
    }).expect(201);
  });

  it('herencia: el hijo suma sus propios wideCardAttribute a los heredados del padre, y el total cuenta para el tope de 6', async () => {
    const parent = await createCategory({
      name: 'ACV Wide Padre', slug: uniqueSlug('acv-wide-padre'),
      attributeSchema: Array.from({ length: 4 }, (_, i) => attr(`p${i}`)),
    }).expect(201);

    // 4 heredados + 3 propios = 7 → 400
    await createCategory({
      name: 'ACV Wide Hijo Overflow', slug: uniqueSlug('acv-wide-hijo-overflow'),
      parentId: parent.body.id,
      attributeSchema: Array.from({ length: 3 }, (_, i) => attr(`c${i}`)),
    }).expect(400);

    // 4 heredados + 2 propios = 6 → 201
    await createCategory({
      name: 'ACV Wide Hijo OK', slug: uniqueSlug('acv-wide-hijo-ok'),
      parentId: parent.body.id,
      attributeSchema: Array.from({ length: 2 }, (_, i) => attr(`d${i}`)),
    }).expect(201);
  });

  // ── GET /categories/:slug — resolución efectiva (herencia) ──────────────

  it('GET /categories/:slug: categoría con config propia devuelve esa config tal cual', async () => {
    const cat = await createCategory({
      name: 'ACV Pública Propia', slug: uniqueSlug('acv-publica-propia'),
      allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA',
    }).expect(201);

    const res = await request(app.getHttpServer()).get(`/api/categories/${cat.body.slug}`).expect(200);
    expect(res.body.allowedViews).toEqual(['LISTA', 'MAPA']);
    expect(res.body.defaultView).toBe('MAPA');
  });

  it('GET /categories/:slug: subcategoría sin config propia hereda la del padre', async () => {
    const parent = await createCategory({
      name: 'ACV Padre Hereda', slug: uniqueSlug('acv-padre-hereda'),
      allowedViews: ['AMPLIADA', 'MAPA'], defaultView: 'AMPLIADA',
    }).expect(201);
    const child = await createCategory({
      name: 'ACV Hijo Hereda', slug: uniqueSlug('acv-hijo-hereda'),
      parentId: parent.body.id,
    }).expect(201);

    const res = await request(app.getHttpServer()).get(`/api/categories/${child.body.slug}`).expect(200);
    expect(res.body.allowedViews).toEqual(['AMPLIADA', 'MAPA']);
    expect(res.body.defaultView).toBe('AMPLIADA');
  });

  it('GET /categories/:slug: sin config propia NI del padre → default global (las 3, LISTA)', async () => {
    const parent = await createCategory({
      name: 'ACV Padre Sin Config', slug: uniqueSlug('acv-padre-sin-config'),
    }).expect(201);
    const child = await createCategory({
      name: 'ACV Hijo Sin Config', slug: uniqueSlug('acv-hijo-sin-config'),
      parentId: parent.body.id,
    }).expect(201);

    const res = await request(app.getHttpServer()).get(`/api/categories/${child.body.slug}`).expect(200);
    expect(res.body.allowedViews).toEqual(['LISTA', 'AMPLIADA', 'MAPA']);
    expect(res.body.defaultView).toBe('LISTA');
  });

  it('GET /categories/:slug: config propia del hijo reemplaza por completo la del padre (sin fusión)', async () => {
    const parent = await createCategory({
      name: 'ACV Padre Reemplazado', slug: uniqueSlug('acv-padre-reemplazado'),
      allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'], defaultView: 'LISTA',
    }).expect(201);
    const child = await createCategory({
      name: 'ACV Hijo Reemplaza', slug: uniqueSlug('acv-hijo-reemplaza'),
      parentId: parent.body.id, allowedViews: ['MAPA'], defaultView: 'MAPA',
    }).expect(201);

    const res = await request(app.getHttpServer()).get(`/api/categories/${child.body.slug}`).expect(200);
    expect(res.body.allowedViews).toEqual(['MAPA']);
    expect(res.body.defaultView).toBe('MAPA');
  });

  it('GET /categories/:slug: expone wideCardAttributes del schema efectivo', async () => {
    const cat = await createCategory({
      name: 'ACV Wide Pública', slug: uniqueSlug('acv-wide-publica'),
      attributeSchema: [attr('marca'), { name: 'color', label: 'Color', type: 'text', filterable: false, required: false }],
    }).expect(201);

    const res = await request(app.getHttpServer()).get(`/api/categories/${cat.body.slug}`).expect(200);
    const keys = (res.body.wideCardAttributes as Array<{ key: string }>).map((a) => a.key);
    expect(keys).toContain('marca');
    expect(keys).not.toContain('color');
  });
});
