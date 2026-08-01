/**
 * BÚSQUEDA+TAGS — RÁFAGA A1 (URLs anidadas de categoría).
 *
 * Tres cambios ADITIVOS de contrato que el frontend necesita para construir
 * /vehiculos/coches (y su breadcrumb) en vez de /coches:
 *   1. GET /categories/:slug devuelve `parent: { slug, name } | null`.
 *   2. GET /categories (árbol) devuelve `parentSlug` en cada hija.
 *   3. GET /listings/:slug devuelve `category.parent`.
 * Antes de A1 la relación con el padre se CARGABA (para resolver herencia) pero
 * no salía en ninguna respuesta — por eso el breadcrumb no podía enseñarla.
 *
 * Y una guarda nueva: una categoría RAÍZ no puede tener un slug que colisione
 * con una ruta estática del sitio (sería inalcanzable). Una HIJA sí puede: su
 * URL lleva el slug del padre delante.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('Categorías — exposición del padre y slugs reservados (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  let parentSlug: string;
  let childSlug: string;
  let parentName: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    await prisma.user.upsert({
      where: { email: 'cpe-admin@example.com' },
      create: {
        email: 'cpe-admin@example.com', name: 'CPE Admin', slug: 'cpe-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
      update: {},
    });
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'cpe-admin@example.com', password: 'Test1234!' });
    adminToken = adminRes.body.accessToken as string;

    const stamp = `${Date.now()}`;
    parentSlug = `cpe-padre-${stamp}`;
    childSlug = `cpe-hija-${stamp}`;
    parentName = 'CPE Padre';

    const parent = await prisma.category.create({
      data: { name: parentName, slug: parentSlug, attributeSchema: [] },
    });
    await prisma.category.create({
      data: { name: 'CPE Hija', slug: childSlug, parentId: parent.id, attributeSchema: [] },
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { category: { slug: { in: [parentSlug, childSlug] } } } });
    await prisma.category.deleteMany({ where: { slug: childSlug } });
    await prisma.category.deleteMany({ where: { slug: parentSlug } });
    await app.close();
    await prisma.$disconnect();
  });

  // ── 1. GET /categories/:slug ────────────────────────────────────────────────

  it('una hija devuelve `parent` con slug y nombre — el dato que alimenta el breadcrumb', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${childSlug}`)
      .expect(200);

    expect(res.body.parent).toEqual({ slug: parentSlug, name: parentName });
  });

  it('una raíz devuelve `parent: null` (no undefined: "es raíz" es una respuesta, no una ausencia)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${parentSlug}`)
      .expect(200);

    expect(res.body.parent).toBeNull();
  });

  it('el resto del contrato de GET /categories/:slug no cambia (aditivo)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${childSlug}`)
      .expect(200);

    // Los campos que ya consumían el wizard y /[...ruta] siguen ahí.
    expect(res.body).toMatchObject({ slug: childSlug });
    expect(Array.isArray(res.body.attributeSchema)).toBe(true);
    expect(Array.isArray(res.body.allowedViews)).toBe(true);
    expect(Array.isArray(res.body.allowedPriceUnits)).toBe(true);
    expect(res.body.allowedListingType).toBeDefined();
    expect(res.body.defaultView).toBeDefined();
  });

  // ── 2. GET /categories (árbol) ──────────────────────────────────────────────

  it('el árbol trae `parentSlug` en cada hija y NO en las raíces', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);

    const root = (res.body as Array<Record<string, unknown>>).find((c) => c.slug === parentSlug);
    expect(root).toBeDefined();
    expect(root!.parentSlug).toBeUndefined();

    const child = (root!.children as Array<Record<string, unknown>>).find((c) => c.slug === childSlug);
    expect(child).toBeDefined();
    expect(child!.parentSlug).toBe(parentSlug);
  });

  // ── 3. GET /listings/:slug ──────────────────────────────────────────────────

  it('la ficha del anuncio trae `category.parent` — sin él la miga no puede ser de 3 niveles', async () => {
    const seller = await prisma.user.upsert({
      where: { email: 'cpe-seller@example.com' },
      create: {
        email: 'cpe-seller@example.com', name: 'CPE Seller', slug: 'cpe-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
      update: {},
    });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: childSlug } });
    const listingSlug = `cpe-anuncio-${Date.now()}`;
    await prisma.listing.create({
      data: {
        title: 'CPE Anuncio', slug: listingSlug, description: 'x', price: 100,
        type: 'PRODUCT', condition: 'GOOD', status: 'ACTIVE', publishedAt: new Date(),
        sellerId: seller.id, categoryId: category.id,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/listings/${listingSlug}`)
      .expect(200);

    expect(res.body.category).toMatchObject({
      slug: childSlug,
      parent: { slug: parentSlug, name: parentName },
    });
  });

  // ── 4. Guarda de slugs reservados ───────────────────────────────────────────

  it('rechaza con 400 una categoría RAÍZ cuyo slug colisiona con una ruta del sitio', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Colisión', slug: 'busqueda' })
      .expect(400);

    expect(String(res.body.message)).toMatch(/reservado/i);
  });

  it('PERMITE ese mismo slug en una HIJA: su URL lleva el padre delante, no colisiona', async () => {
    const parent = await prisma.category.findUniqueOrThrow({ where: { slug: parentSlug } });
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Blog de la categoría', slug: 'blog', parentId: parent.id })
      .expect(201);

    expect(res.body.slug).toBe('blog');
    await prisma.category.delete({ where: { id: res.body.id } });
  });

  it('el guard también aplica al RENOMBRAR una raíz (PATCH), no solo al crearla', async () => {
    const root = await prisma.category.findUniqueOrThrow({ where: { slug: parentSlug } });
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/categories/${root.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: 'planes' })
      .expect(400);

    expect(String(res.body.message)).toMatch(/reservado/i);

    // Y no ha tocado nada: la categoría conserva su slug.
    const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: root.id } });
    expect(unchanged.slug).toBe(parentSlug);
  });

  it('un slug NO reservado sigue creándose sin fricción (la guarda no es un muro general)', async () => {
    const slug = `cpe-libre-${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Libre', slug })
      .expect(201);

    await prisma.category.delete({ where: { id: res.body.id } });
  });
});
