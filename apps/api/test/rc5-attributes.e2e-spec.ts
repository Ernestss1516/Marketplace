import { INestApplication } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';

// Slugs used exclusively by this suite — pre-deleted in beforeAll.
const RC5_SLUGS = [
  'rc5-tech-parent',
  'rc5-ordenadores-test',
  'rc5-calzado-test',
  'rc5-card-overflow',
  'rc5-card-ok',
  'rc5-card-por-tipo-ok',
  'rc5-card-producto-overflow',
  'rc5-card-ambos-overflow',
  'rc5-widecard-por-tipo-ok',
  'rc5-appliesto-tree',
];

describe('RC5 — Categorías y atributos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

  let adminToken: string;
  let moderatorToken: string;
  let sellerToken: string;
  let sellerId: string;

  let catItemTypeId: string;
  let catCalzadoId: string;
  let catParentId: string;
  let catChildId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    // App boot happens AFTER the test categories below are created: search's
    // FilterableAttributesResolver resolves its filterable-attribute map once
    // at boot (no hot refresh — see RÁFAGA 0), so a category created after
    // app.init() would not be filterable within this same test run.
    await cleanDb(prisma);
    await resetMeili(meili);

    // Remove any leftover categories from a previous run.
    await prisma.category.deleteMany({ where: { slug: { in: RC5_SLUGS } } });

    const hash = (pw: string) => bcrypt.hash(pw, 4);

    const [admin, moderator, seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'rc5-admin@example.com',
          name: 'RC5 Admin',
          slug: 'rc5-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rc5-mod@example.com',
          name: 'RC5 Moderator',
          slug: 'rc5-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rc5-seller@example.com',
          name: 'RC5 Seller',
          slug: 'rc5-seller',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      }),
    ]);
    sellerId = seller.id;

    // ── Test categories ───────────────────────────────────────────────────────

    // Parent for inheritance test: has brand + year
    const catParent = await prisma.category.create({
      data: {
        name: 'Tech Parent RC5',
        slug: 'rc5-tech-parent',
        order: 99,
        attributeSchema: [
          { name: 'brand', label: 'Marca (parent)', type: 'text', filterable: true, required: false },
          { name: 'year', label: 'Año', type: 'number', filterable: true, required: false },
        ],
      },
    });
    catParentId = catParent.id;

    // Child of rc5-tech-parent: has itemType (new) + brand (override) → year is inherited
    const catChild = await prisma.category.create({
      data: {
        name: 'Ordenadores RC5 Test',
        slug: 'rc5-ordenadores-test',
        order: 1,
        parentId: catParentId,
        attributeSchema: [
          {
            name: 'itemType',
            label: 'Tipo',
            type: 'select',
            options: ['Portátil', 'Sobremesa', 'Mini PC'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false, cardAttribute: true },
        ],
      },
    });
    catChildId = catChild.id;
    catItemTypeId = catChild.id;

    // Calzado-like category: size as string select (after RC5.2 normalisation)
    const catCalzado = await prisma.category.create({
      data: {
        name: 'Calzado RC5 Test',
        slug: 'rc5-calzado-test',
        order: 99,
        attributeSchema: [
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
            filterable: true,
            required: false,
          },
        ],
      },
    });
    catCalzadoId = catCalzado.id;

    // App boots now that every test category (with its filterable attributes)
    // already exists in the DB — see the note in the beforeAll preamble above.
    app = await createTestApp();
    await app.init();

    // ── Login ─────────────────────────────────────────────────────────────────
    const [adminRes, modRes, sellerRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'rc5-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rc5-mod@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rc5-seller@example.com', password: 'Test1234!' }),
    ]);
    adminToken = adminRes.body.accessToken as string;
    moderatorToken = modRes.body.accessToken as string;
    sellerToken = sellerRes.body.accessToken as string;

    // ── Create + publish listings ─────────────────────────────────────────────

    // Listing 1: itemType attribute
    const listingItemTypeRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Portátil de Prueba RC5',
        description: 'Test listing for itemType filter',
        price: 450,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: catItemTypeId,
        city: 'Madrid',
        province: 'Madrid',
        attributes: { itemType: 'Portátil', brand: 'TestBrand' },
      });
    expect(listingItemTypeRes.status).toBe(201);
    const listingItemTypeId = listingItemTypeRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${listingItemTypeId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await waitForIndex(meili, INDEX, listingItemTypeId);

    // Listing 2: size as string (calzado)
    const listingCalzadoRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Zapatillas Talla 38 RC5',
        description: 'Test listing for size=38 string filter',
        price: 60,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: catCalzadoId,
        city: 'Barcelona',
        province: 'Barcelona',
        attributes: { size: '38' },
      });
    expect(listingCalzadoRes.status).toBe(201);
    const listingCalzadoId = listingCalzadoRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${listingCalzadoId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await waitForIndex(meili, INDEX, listingCalzadoId);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── itemType filter (deuda técnica resuelta) ─────────────────────────────

  it('GET /api/search?itemType=Portátil filtra por itemType correctamente', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ itemType: 'Portátil', category: 'rc5-ordenadores-test' })
      .expect(200);

    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].title).toBe('Portátil de Prueba RC5');
  });

  it('GET /api/search?itemType=Sobremesa devuelve 0 resultados (no hay Sobremesa)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ itemType: 'Sobremesa' })
      .expect(200);

    // The only listing has itemType=Portátil, so Sobremesa yields 0
    const desktopHits = (res.body.hits as Array<{ id: string }>).filter((h) =>
      h.id.startsWith('rc5-'),
    );
    expect(desktopHits).toHaveLength(0);
  });

  // ── size calzado (string normalisation) ──────────────────────────────────

  it('GET /api/search?size=38 filtra calzado correctamente (size como string)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ size: '38', category: 'rc5-calzado-test' })
      .expect(200);

    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].title).toBe('Zapatillas Talla 38 RC5');
  });

  it('GET /api/search?size=42 devuelve 0 resultados para rc5-calzado-test', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ size: '42', category: 'rc5-calzado-test' })
      .expect(200);

    expect(res.body.hits).toHaveLength(0);
  });

  // ── RÁFAGA 1 — fix del leak cross-categoría ──────────────────────────────

  it('GET /api/search?category=rc5-calzado-test&itemType=Portátil → 400 (itemType es de otra categoría, no de calzado)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: 'rc5-calzado-test', itemType: 'Portátil' })
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('itemType')]),
    );
  });

  it('GET /api/search?itemType=Portátil SIN categoría sigue aceptándose (unión global, /busqueda general)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ itemType: 'Portátil' })
      .expect(200);

    expect(res.body.hits.some((h: { title: string }) => h.title === 'Portátil de Prueba RC5')).toBe(true);
  });

  it('GET /api/search?category=rc5-tech-parent&itemType=Portátil → 200 (categoría padre agrega los atributos del hijo)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: 'rc5-tech-parent', itemType: 'Portátil' })
      .expect(200);

    expect(res.body.hits.some((h: { title: string }) => h.title === 'Portátil de Prueba RC5')).toBe(true);
  });

  // ── Herencia de atributos ────────────────────────────────────────────────

  it('GET /api/categories/:slug devuelve schema efectivo: year heredado + itemType y brand del hijo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/rc5-ordenadores-test')
      .expect(200);

    const schema: Array<{ name: string; label: string }> = res.body.attributeSchema;
    const names = schema.map((f) => f.name);

    // year is inherited from parent (not overridden by child)
    expect(names).toContain('year');
    // itemType is the child's own attribute
    expect(names).toContain('itemType');
    // brand is the child's override of parent's brand
    expect(names).toContain('brand');

    // Child's brand label overrides parent's label
    const brandField = schema.find((f) => f.name === 'brand');
    expect(brandField?.label).toBe('Marca'); // child label, not 'Marca (parent)'

    // Total: 3 fields (year inherited, itemType own, brand override)
    expect(schema).toHaveLength(3);
  });

  it('GET /api/categories/:slug de categoría raíz devuelve su propio schema sin herencia', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/rc5-tech-parent')
      .expect(200);

    const names = res.body.attributeSchema.map((f: { name: string }) => f.name);
    expect(names).toEqual(['brand', 'year']);
  });

  // ── GET /api/categories (tree) incluye cardAttributes ───────────────────

  it('GET /api/categories tree incluye cardAttributes en hijos', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);

    type CardAttr = { key: string; label: string; unit?: string };
    const parentNode = (res.body as Array<{ slug: string; children?: Array<{ slug: string; cardAttributes: CardAttr[] }> }>)
      .find((c) => c.slug === 'rc5-tech-parent');
    expect(parentNode).toBeDefined();

    const childNode = parentNode?.children?.find((c) => c.slug === 'rc5-ordenadores-test');
    expect(childNode).toBeDefined();

    // Effective schema has itemType (cardAttribute:true) and brand (cardAttribute:true)
    // year is inherited but NOT cardAttribute
    const keys = childNode?.cardAttributes.map((a) => a.key) ?? [];
    expect(keys).toContain('itemType');
    expect(keys).toContain('brand');
    expect(keys).not.toContain('year');
    expect(childNode?.cardAttributes).toHaveLength(2);
    // Each entry has key + label (unit is optional)
    for (const attr of childNode?.cardAttributes ?? []) {
      expect(typeof attr.key).toBe('string');
      expect(typeof attr.label).toBe('string');
    }
  });

  it('GET /api/categories tree propaga appliesTo en cardAttributes (antes se perdía en toAttrDef)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'AppliesTo Tree RC5',
        slug: 'rc5-appliesto-tree',
        order: 99,
        attributeSchema: [
          { name: 'rate', label: 'Tarifa/hora', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['SERVICE'] },
        ],
      })
      .expect(201);

    try {
      const tree = await request(app.getHttpServer()).get('/api/categories').expect(200);
      type CardAttr = { key: string; appliesTo?: string[] };
      const node = (tree.body as Array<{ slug: string; cardAttributes: CardAttr[] }>)
        .find((c) => c.slug === 'rc5-appliesto-tree');
      expect(node).toBeDefined();
      const rateAttr = node?.cardAttributes.find((a) => a.key === 'rate');
      expect(rateAttr?.appliesTo).toEqual(['SERVICE']);
    } finally {
      await prisma.category.delete({ where: { id: created.body.id } });
    }
  });

  // ── Validación max 2 cardAttribute ───────────────────────────────────────

  it('POST /admin/categories con 3 atributos cardAttribute → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Card Overflow RC5',
        slug: 'rc5-card-overflow',
        order: 99,
        attributeSchema: [
          { name: 'a', label: 'A', type: 'text', filterable: false, required: false, cardAttribute: true },
          { name: 'b', label: 'B', type: 'text', filterable: false, required: false, cardAttribute: true },
          { name: 'c', label: 'C', type: 'text', filterable: false, required: false, cardAttribute: true },
        ],
      })
      .expect(400);

    expect(res.body.message).toMatch(/cardAttribute/);
    expect(res.body.message).toMatch(/máximo.*2|2.*máximo/i);
  });

  it('POST /admin/categories con exactamente 2 cardAttribute → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Card OK RC5',
        slug: 'rc5-card-ok',
        order: 99,
        attributeSchema: [
          { name: 'x', label: 'X', type: 'text', filterable: false, required: false, cardAttribute: true },
          { name: 'y', label: 'Y', type: 'text', filterable: false, required: false, cardAttribute: true },
          { name: 'z', label: 'Z', type: 'text', filterable: false, required: false },
        ],
      })
      .expect(201);

    // Cleanup
    await prisma.category.delete({ where: { id: res.body.id } });
  });

  // ── ATRIBUTOS EN CARD — respetar producto/servicio: el tope de card se valida
  // POR TIPO, no globalmente (un atributo solo-PRODUCT o solo-SERVICE solo cuenta
  // en el tope de ese tipo; uno sin appliesTo cuenta en los dos) ────────────────

  it('POST /admin/categories con 2 cardAttribute de PRODUCT + 2 de SERVICE (4 en total) → 201: el tope se cumple por tipo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Card Por Tipo RC5',
        slug: 'rc5-card-por-tipo-ok',
        order: 99,
        attributeSchema: [
          { name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'year', label: 'Año', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'rate', label: 'Tarifa/hora', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['SERVICE'] },
          { name: 'displacement', label: 'Desplazamiento', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['SERVICE'] },
        ],
      })
      .expect(201);

    await prisma.category.delete({ where: { id: res.body.id } });
  });

  it('POST /admin/categories con 3 cardAttribute de PRODUCT (aunque solo 2 sean de SERVICE) → 400 nombrando el tipo que excede', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Card Producto Overflow RC5',
        slug: 'rc5-card-producto-overflow',
        order: 99,
        attributeSchema: [
          { name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'year', label: 'Año', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'rate', label: 'Tarifa/hora', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['SERVICE'] },
        ],
      })
      .expect(400);

    expect(res.body.message).toMatch(/cardAttribute/);
    expect(res.body.message).toMatch(/producto/i);
    expect(res.body.message).toMatch(/máximo.*2|2.*máximo/i);
  });

  it('un atributo "ambos" cuenta en las dos cuentas: 2 de producto + 1 sin appliesTo → 3 de producto → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Card Ambos Overflow RC5',
        slug: 'rc5-card-ambos-overflow',
        order: 99,
        attributeSchema: [
          { name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'year', label: 'Año', type: 'number', filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT'] },
          { name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false, cardAttribute: true },
        ],
      })
      .expect(400);

    expect(res.body.message).toMatch(/producto/i);
  });

  it('el tope de wideCardAttribute (6) también se valida por tipo: 3 PRODUCT + 3 SERVICE (6 en total) → 201', async () => {
    const attrs = [1, 2, 3].flatMap((n) => [
      { name: `p${n}`, label: `P${n}`, type: 'text' as const, filterable: false, required: false, wideCardAttribute: true, appliesTo: ['PRODUCT'] as const },
      { name: `s${n}`, label: `S${n}`, type: 'text' as const, filterable: false, required: false, wideCardAttribute: true, appliesTo: ['SERVICE'] as const },
    ]);
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'WideCard Por Tipo RC5',
        slug: 'rc5-widecard-por-tipo-ok',
        order: 99,
        attributeSchema: attrs,
      })
      .expect(201);

    await prisma.category.delete({ where: { id: res.body.id } });
  });

  // ── GET /admin/categories/searchable-keys ────────────────────────────────

  it('GET /admin/categories/searchable-keys como ADMIN → 200 con lista de claves', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/categories/searchable-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.keys).toBeInstanceOf(Array);
    // Must contain the recently added itemType key
    expect(res.body.keys).toContain('itemType');
    // Must contain this suite's own filterable attribute keys
    expect(res.body.keys).toContain('brand');
    expect(res.body.keys).toContain('size');
  });

  it('GET /admin/categories/searchable-keys sin auth → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/categories/searchable-keys')
      .expect(401);
  });

  it('GET /admin/categories/searchable-keys como MODERATOR → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/categories/searchable-keys')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });
});
