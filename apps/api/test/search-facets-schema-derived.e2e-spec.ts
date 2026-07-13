/**
 * AUDITORÍA DE FILTROS — FACET_ATTRIBUTES (lista editorial fija) sustituida por
 * facetas derivadas del schema (FilterableAttributesResolver, scoped por
 * categoría). LA prueba pedida: marcar un atributo nuevo como filterable:true
 * y comprobar que aparece como faceta SIN tocar código — antes de este fix,
 * "km" (usado aquí a propósito: nunca estuvo en la lista editorial vieja)
 * jamás habría generado una faceta aunque el backend ya aceptara `?km=...`
 * como filtro válido.
 *
 * Categoría creada ANTES de app.init() — mismo motivo que en R0/R1/R2/R3/R4:
 * FilterableAttributesResolver memoiza su mapa al arrancar.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient } from './helpers/db';
import { waitForIndex } from './helpers/meili';

describe('Facetas derivadas del schema (e2e) — auditoría de filtros', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

  let categorySlugA: string;
  let categorySlugB: string;
  let sellerToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();

    categorySlugA = `facet-derived-a-${Date.now()}`;
    categorySlugB = `facet-derived-b-${Date.now()}`;
    await prisma.category.create({
      data: {
        name: 'Facet Derived A', slug: categorySlugA, order: 994, allowedListingType: 'BOTH',
        attributeSchema: [
          // "km": nunca estuvo en la vieja lista editorial FACET_ATTRIBUTES.
          { name: 'km', label: 'Kilometraje', type: 'number', filterable: true, required: false },
          // Marcado explícitamente NO filtrable — no debe generar faceta.
          { name: 'notes', label: 'Notas internas', type: 'text', filterable: false, required: false },
        ],
      },
    });
    await prisma.category.create({
      data: {
        name: 'Facet Derived B', slug: categorySlugB, order: 993, allowedListingType: 'BOTH',
        attributeSchema: [
          { name: 'subject', label: 'Materia', type: 'text', filterable: true, required: false },
        ],
      },
    });

    app = await createTestApp();
    await app.init();

    const seller = await prisma.user.create({
      data: {
        email: `facet-derived-seller-${Date.now()}@example.com`,
        name: 'Facet Derived Seller',
        slug: `facet-derived-seller-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: seller.email, password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;

    async function createAndPublish(categorySlug: string, attributes: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: `Facet Derived ${Date.now()}`,
          description: 'Descripción de prueba para facetas derivadas del schema.',
          price: 100,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          categoryId: (await prisma.category.findUniqueOrThrow({ where: { slug: categorySlug } })).id,
          city: 'Madrid',
          province: 'Madrid',
          attributes,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/listings/${res.body.id}/publish`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      await waitForIndex(meili, INDEX, res.body.id);
    }

    await createAndPublish(categorySlugA, { km: 50000, notes: 'no debería facetarse' });
    await createAndPublish(categorySlugB, { subject: 'Matemáticas' });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('LA PRUEBA: "km" (filterable:true, nunca estuvo en la lista editorial vieja) aparece como faceta', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlugA })
      .expect(200);

    expect(res.body.facets?.km).toEqual({ 50000: 1 });
  });

  it('un atributo marcado filterable:false NO aparece como faceta', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlugA })
      .expect(200);

    expect(res.body.facets?.notes).toBeUndefined();
  });

  it('las facetas de una categoría son las SUYAS, no las de todas: "subject" (de otra categoría) no aparece al buscar en A', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlugA })
      .expect(200);

    expect(res.body.facets?.subject).toBeUndefined();
  });

  it('...y viceversa: "km" no aparece al buscar en B', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlugB })
      .expect(200);

    expect(res.body.facets?.km).toBeUndefined();
    expect(res.body.facets?.subject).toEqual({ Matemáticas: 1 });
  });

  it('sin categoría (/busqueda general) → la unión global incluye ambos atributos filtrables', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ q: 'Facet Derived' })
      .expect(200);

    expect(res.body.facets?.km).toBeDefined();
    expect(res.body.facets?.subject).toBeDefined();
  });

  it('los filtros nativos (type, condition, priceType, province) siguen siendo facetas siempre', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlugA })
      .expect(200);

    expect(res.body.facets?.type).toBeDefined();
    expect(res.body.facets?.condition).toBeDefined();
    expect(res.body.facets?.priceType).toBeDefined();
    expect(res.body.facets?.province).toBeDefined();
  });
});
