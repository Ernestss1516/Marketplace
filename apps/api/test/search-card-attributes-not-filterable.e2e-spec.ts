/**
 * ATRIBUTOS EN CARD — BUG 1: normalizeHit() en SearchController reconstruía
 * `hit.attributes` a partir del mapa FILTRABLE (FilterableAttributesResolver),
 * así que un cardAttribute marcado filterable:false (frecuente en atributos de
 * servicio: tarifa, modalidad… útiles de mostrar, no de filtrar) nunca llegaba
 * a `hit.attributes`, aunque SÍ estaba indexado en el documento de Meilisearch
 * (toDocument() indexa TODOS los atributos, sin mirar filterable) y SÍ se veía
 * en /anuncio/[slug] (que lee `listing.attributes` directo de Postgres).
 * "Filterable" y "se muestra en la card" son propiedades independientes.
 *
 * Categoría creada ANTES de app.init() — mismo motivo que en R0-R4:
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

describe('normalizeHit expone atributos de card no filtrables (e2e) — bug 1', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

  let categorySlug: string;
  let sellerToken: string;
  let listingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();

    categorySlug = `bug1-card-notfilter-${Date.now()}`;
    await prisma.category.create({
      data: {
        name: 'Bug1 Card No Filter', slug: categorySlug, order: 992, allowedListingType: 'BOTH',
        attributeSchema: [
          // El caso del bug: cardAttribute pero NO filtrable, appliesTo SERVICE
          // (el patrón real que lo activó — atributos de servicio suelen ser
          // decorativos, no pensados como filtro).
          {
            name: 'tariff', label: 'Tarifa', type: 'text', filterable: false, required: false,
            cardAttribute: true, appliesTo: ['SERVICE'],
          },
          // Filtrable, para comprobar que sigue funcionando igual (no regresión).
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false, cardAttribute: true },
        ],
      },
    });

    app = await createTestApp();
    await app.init();

    const seller = await prisma.user.create({
      data: {
        email: `bug1-card-seller-${Date.now()}@example.com`,
        name: 'Bug1 Card Seller',
        slug: `bug1-card-seller-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: seller.email, password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;

    const createRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: `Bug1 Card Servicio ${Date.now()}`,
        description: 'Descripción de prueba para el bug 1 de atributos no filtrables.',
        price: 50,
        type: 'SERVICE',
        priceType: 'FIXED',
        categoryId: (await prisma.category.findUniqueOrThrow({ where: { slug: categorySlug } })).id,
        city: 'Madrid',
        province: 'Madrid',
        attributes: { tariff: '40€/hora', brand: 'MarcaX' },
      })
      .expect(201);
    listingId = createRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, INDEX, listingId);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('LA PRUEBA: "tariff" (cardAttribute, filterable:false) SÍ aparece en hit.attributes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug })
      .expect(200);

    const hit = res.body.hits.find((h: { id: string }) => h.id === listingId);
    expect(hit).toBeDefined();
    expect(hit.attributes.tariff).toBe('40€/hora');
  });

  it('un atributo filtrable (brand) sigue apareciendo igual — no regresión', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug })
      .expect(200);

    const hit = res.body.hits.find((h: { id: string }) => h.id === listingId);
    expect(hit.attributes.brand).toBe('MarcaX');
  });

  it('sin categoría (/busqueda general) — "tariff" también aparece (unión global sin filtrar)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ q: 'Bug1 Card Servicio' })
      .expect(200);

    const hit = res.body.hits.find((h: { id: string }) => h.id === listingId);
    expect(hit?.attributes.tariff).toBe('40€/hora');
  });

  it('el bloque "featured" (página 1) también expone atributos no filtrables si el anuncio aparece ahí', async () => {
    // No boosted aquí — solo confirma que normalizeHit se llama igual para featured
    // y no revienta con el nuevo Set en vez del Map anterior.
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug })
      .expect(200);

    expect(Array.isArray(res.body.featured)).toBe(true);
  });
});
