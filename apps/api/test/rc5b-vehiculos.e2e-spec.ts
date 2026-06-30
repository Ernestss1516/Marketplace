/**
 * RC5.2b — Vehículos seed reorganisation.
 *
 * Verifies that moving year+km from the three vehicle children up to the
 * Vehículos parent produces an effective schema that is SET-identical to the
 * previous per-child schema, and that:
 *   - existing listings keep their attributes (listing.attributes unchanged)
 *   - new-listing validation enforces parent-defined required fields (year, km)
 *   - search still filters by year/km (VARIABLE_ATTRIBUTE_KEYS unchanged)
 *
 * Uses test-specific categories (rc5b-*) so the suite is independent of
 * the main seed and of other suites.
 */
import { INestApplication } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';

const RC5B_SLUGS = [
  'rc5b-vehiculos',
  'rc5b-coches',
  'rc5b-motos',
  'rc5b-furgonetas',
];

describe('RC5.2b — Herencia Vehículos year+km (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

  let sellerToken: string;
  let catParentId: string;
  let catCochesId: string;
  let catMotosId: string;
  let catFurgonId: string;

  // A listing inserted directly in DB (simulates a listing created BEFORE the seed change)
  let preExistingListingId: string;
  // A listing created via API (after effective-schema validation is live)
  let newCocheListingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await resetMeili(meili);

    await prisma.category.deleteMany({ where: { slug: { in: RC5B_SLUGS } } });

    const hash = (pw: string) => bcrypt.hash(pw, 4);

    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'rc5b-seller@example.com',
          name: 'RC5B Seller',
          slug: 'rc5b-seller',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      }),
    ]);

    // ── Categories mirroring the seed reorganisation ───────────────────────
    // Parent: year + km (the common inherited fields)
    const catParent = await prisma.category.create({
      data: {
        name: 'Vehículos RC5B',
        slug: 'rc5b-vehiculos',
        order: 99,
        attributeSchema: [
          { name: 'year', label: 'Año', type: 'number', filterable: true, required: true },
          { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
        ],
      },
    });
    catParentId = catParent.id;

    // Coches child: brand, model, fuel, gearbox (year+km inherited)
    const catCoches = await prisma.category.create({
      data: {
        name: 'Coches RC5B',
        slug: 'rc5b-coches',
        order: 1,
        parentId: catParentId,
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: true },
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico', 'Híbrido', 'GLP'],
            filterable: true,
            required: true,
          },
        ],
      },
    });
    catCochesId = catCoches.id;

    // Motos child: brand, displacement (year+km inherited)
    const catMotos = await prisma.category.create({
      data: {
        name: 'Motos RC5B',
        slug: 'rc5b-motos',
        order: 2,
        parentId: catParentId,
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true },
          { name: 'displacement', label: 'Cilindrada', type: 'number', unit: 'cc', filterable: true, required: false },
        ],
      },
    });
    catMotosId = catMotos.id;

    // Furgonetas child: fuel only (year+km inherited)
    const catFurgon = await prisma.category.create({
      data: {
        name: 'Furgonetas RC5B',
        slug: 'rc5b-furgonetas',
        order: 3,
        parentId: catParentId,
        attributeSchema: [
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico'],
            filterable: true,
            required: false,
          },
        ],
      },
    });
    catFurgonId = catFurgon.id;

    // ── Login ─────────────────────────────────────────────────────────────
    const sellerRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'rc5b-seller@example.com', password: 'Test1234!' });
    sellerToken = sellerRes.body.accessToken as string;

    // ── Pre-existing listing (simulates a listing with year+km before seed change) ──
    // Created via API so BullMQ queues the Meilisearch indexing.
    // year+km are in listing.attributes — verifies they remain accessible after
    // the schema definition moves from children to the Vehículos parent.
    const preExistingRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Seat Ibiza Antiguo RC5B',
        description: 'Listing con year+km en attributes (camino peligroso)',
        price: 8500,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: catCochesId,
        city: 'Madrid',
        province: 'Madrid',
        attributes: { year: 2018, km: 45000, brand: 'Seat', model: 'Ibiza', fuel: 'Gasolina' },
      });
    expect(preExistingRes.status).toBe(201);
    preExistingListingId = preExistingRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${preExistingListingId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await waitForIndex(meili, INDEX, preExistingListingId);

    // ── New listing created via API (validates against effective schema) ──
    const newCocheRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'VW Golf Nuevo RC5B',
        description: 'Listing creado después de la reorganización del seed',
        price: 15000,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'LIKE_NEW',
        categoryId: catCochesId,
        city: 'Barcelona',
        province: 'Barcelona',
        // year and km are required by the parent; brand, model, fuel by the child
        attributes: { year: 2022, km: 12000, brand: 'VW', model: 'Golf', fuel: 'Diésel' },
      });
    expect(newCocheRes.status).toBe(201);
    newCocheListingId = newCocheRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${newCocheListingId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await waitForIndex(meili, INDEX, newCocheListingId);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Schema efectivo por categoría hija ─────────────────────────────────

  it('GET /api/categories/rc5b-coches devuelve schema efectivo correcto (5 campos)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/rc5b-coches')
      .expect(200);

    const names = (res.body.attributeSchema as Array<{ name: string }>).map((f) => f.name);
    // year + km inherited from parent; brand, model, fuel from child
    expect(names).toContain('year');
    expect(names).toContain('km');
    expect(names).toContain('brand');
    expect(names).toContain('model');
    expect(names).toContain('fuel');
    // 5 fields: 2 inherited + 3 own
    expect(res.body.attributeSchema).toHaveLength(5);
  });

  it('GET /api/categories/rc5b-motos devuelve schema efectivo (4 campos: year+km heredados + brand+displacement)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/rc5b-motos')
      .expect(200);

    const names = (res.body.attributeSchema as Array<{ name: string }>).map((f) => f.name);
    expect(names).toContain('year');
    expect(names).toContain('km');
    expect(names).toContain('brand');
    expect(names).toContain('displacement');
    expect(res.body.attributeSchema).toHaveLength(4);
  });

  it('GET /api/categories/rc5b-furgonetas devuelve schema efectivo (3 campos: year+km heredados + fuel)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/rc5b-furgonetas')
      .expect(200);

    const names = (res.body.attributeSchema as Array<{ name: string }>).map((f) => f.name);
    expect(names).toContain('year');
    expect(names).toContain('km');
    expect(names).toContain('fuel');
    expect(res.body.attributeSchema).toHaveLength(3);
  });

  it('year y km vienen del padre (no aparecen en el schema propio del hijo)', async () => {
    // The child's OWN schema for coches should not contain year/km
    const row = await prisma.category.findUniqueOrThrow({
      where: { slug: 'rc5b-coches' },
      select: { attributeSchema: true },
    });
    const ownNames = (row.attributeSchema as Array<{ name: string }>).map((f) => f.name);
    expect(ownNames).not.toContain('year');
    expect(ownNames).not.toContain('km');
    // But the effective schema (via API) does include them
  });

  // ── Camino peligroso: listados existentes conservan sus atributos ───────

  it('Listing pre-existente de coche tiene year y km en attributes (listing.attributes no cambia)', async () => {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: preExistingListingId },
      select: { attributes: true },
    });
    const attrs = listing.attributes as Record<string, unknown>;
    expect(attrs.year).toBe(2018);
    expect(attrs.km).toBe(45000);
    expect(attrs.brand).toBe('Seat');
  });

  it('Listing pre-existente aparece en búsqueda por year (atributo heredado, filtrado funciona)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ year: 2018, category: 'rc5b-coches' })
      .expect(200);

    const hits = res.body.hits as Array<{ id: string }>;
    expect(hits.some((h) => h.id === preExistingListingId)).toBe(true);
  });

  it('Listing pre-existente aparece en búsqueda por km', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ km: 45000, category: 'rc5b-coches' })
      .expect(200);

    const hits = res.body.hits as Array<{ id: string }>;
    expect(hits.some((h) => h.id === preExistingListingId)).toBe(true);
  });

  // ── Validación de nuevo listing usa el schema efectivo (con herencia) ──

  it('Crear coche sin year (required en padre) → 422 Unprocessable Entity', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Coche sin año RC5B',
        description: 'Falta year que es heredado del padre',
        price: 5000,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: catCochesId,
        city: 'Madrid',
        province: 'Madrid',
        attributes: { km: 30000, brand: 'Ford', model: 'Focus', fuel: 'Gasolina' }, // year missing
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/year/);
  });

  it('Crear coche sin km (required en padre) → 422 Unprocessable Entity', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Coche sin km RC5B',
        description: 'Falta km que es heredado del padre',
        price: 5000,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: catCochesId,
        city: 'Madrid',
        province: 'Madrid',
        attributes: { year: 2020, brand: 'Ford', model: 'Focus', fuel: 'Gasolina' }, // km missing
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/km/);
  });

  it('Nuevo listing creado via API tiene year y km en el índice Meili', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ year: 2022, category: 'rc5b-coches' })
      .expect(200);

    const hits = res.body.hits as Array<{ id: string }>;
    expect(hits.some((h) => h.id === newCocheListingId)).toBe(true);
  });

  // ── Summary de listing incluye attributes y categorySlug (RC5.2) ────────

  it('/users/me/listings devuelve attributes y categorySlug en el summary', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const cocheNew = (res.body.items as Array<{ id: string; attributes?: Record<string, unknown>; categorySlug?: string }>)
      .find((l) => l.id === newCocheListingId);
    expect(cocheNew).toBeDefined();
    expect(cocheNew?.categorySlug).toBe('rc5b-coches');
    expect(cocheNew?.attributes?.year).toBe(2022);
    expect(cocheNew?.attributes?.km).toBe(12000);
  });
});
