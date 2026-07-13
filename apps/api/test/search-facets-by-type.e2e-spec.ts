/**
 * CAMBIO PRODUCTO/SERVICIO — RÁFAGA 4 (búsqueda y ficha): verificación EMPÍRICA
 * de que las facetas de atributos quedan acotadas por tipo "gratis" — no es
 * código nuevo, es un efecto del mecanismo ya existente:
 *   1. SearchService.search() incluye `type` en el MISMO array `filters` que
 *      se pasa como base de `facets` en la misma llamada a Meilisearch — la
 *      facetDistribution se calcula sobre el resultado YA filtrado por tipo.
 *   2. Los atributos appliesTo-restringidos (R1) nunca se guardan en anuncios
 *      del tipo que no les aplica (wizard + validación en create(), R1/R3).
 * Categorías creadas ANTES de app.init() — mismo motivo que en R0/R1/R2/R3:
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

describe('Facetas conscientes del tipo — RÁFAGA 4 (e2e, verificación empírica)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

  let categorySlug: string;
  let sellerToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();

    categorySlug = `r4-facet-test-${Date.now()}`;
    await prisma.category.create({
      data: {
        name: 'R4 Facet Test',
        slug: categorySlug,
        order: 995,
        allowedListingType: 'BOTH',
        attributeSchema: [
          {
            name: 'gearbox', label: 'Cambio', type: 'select',
            options: ['Manual', 'Automático'], filterable: true, required: false,
            appliesTo: ['PRODUCT'],
          },
          {
            name: 'modality', label: 'Modalidad', type: 'select',
            options: ['Presencial', 'Online'], filterable: true, required: false,
            appliesTo: ['SERVICE'],
          },
        ],
      },
    });

    // App boots DESPUÉS de crear la categoría — FilterableAttributesResolver
    // debe ver gearbox/modality en su mapa memoizado al arrancar.
    app = await createTestApp();
    await app.init();

    const seller = await prisma.user.create({
      data: {
        email: `r4-facet-seller-${Date.now()}@example.com`,
        name: 'R4 Facet Seller',
        slug: `r4-facet-seller-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: seller.email, password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;

    async function createAndPublish(type: 'PRODUCT' | 'SERVICE', attributes: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: `R4 Facet ${type} ${Date.now()}`,
          description: 'Descripción de prueba para facetas por tipo.',
          price: 100,
          type,
          priceType: 'FIXED',
          ...(type === 'PRODUCT' ? { condition: 'GOOD' } : {}),
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
      return res.body.id as string;
    }

    await createAndPublish('PRODUCT', { gearbox: 'Manual' });
    await createAndPublish('SERVICE', { modality: 'Online' });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('filtrar type=SERVICE → la faceta gearbox (solo-PRODUCT) está ausente o vacía', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'SERVICE' })
      .expect(200);

    const gearboxFacet = res.body.facets?.gearbox as Record<string, number> | undefined;
    expect(gearboxFacet === undefined || Object.keys(gearboxFacet).length === 0).toBe(true);
  });

  it('filtrar type=SERVICE → la faceta modality (solo-SERVICE) SÍ tiene valores', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'SERVICE' })
      .expect(200);

    expect(res.body.facets?.modality).toEqual({ Online: 1 });
  });

  it('filtrar type=PRODUCT → la faceta modality (solo-SERVICE) está ausente o vacía', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'PRODUCT' })
      .expect(200);

    const modalityFacet = res.body.facets?.modality as Record<string, number> | undefined;
    expect(modalityFacet === undefined || Object.keys(modalityFacet).length === 0).toBe(true);
  });

  it('filtrar type=PRODUCT → la faceta gearbox (solo-PRODUCT) SÍ tiene valores', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'PRODUCT' })
      .expect(200);

    expect(res.body.facets?.gearbox).toEqual({ Manual: 1 });
  });

  it('sin filtro de tipo (categoría BOTH) → ambas facetas aparecen', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug })
      .expect(200);

    expect(res.body.facets?.gearbox).toEqual({ Manual: 1 });
    expect(res.body.facets?.modality).toEqual({ Online: 1 });
  });

  // AUDITORÍA DE FILTROS — BUG B: "condition" (estado de conservación) no aplica a
  // SERVICE, igual que un atributo appliesTo:['PRODUCT'] no aplica a un anuncio
  // SERVICE. Antes de este fix, `type=SERVICE&condition=NEW` no daba error: se
  // limitaba a devolver 0 resultados en silencio (ningún SERVICE tiene `condition`).
  it('type=SERVICE + condition → 400 (condition no aplica a servicios)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'SERVICE', condition: 'NEW' })
      .expect(400);

    expect(res.body.message).toContain('condition no aplica a anuncios de tipo SERVICE');
  });

  it('type=PRODUCT + condition → sigue permitido (200)', async () => {
    await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, type: 'PRODUCT', condition: 'GOOD' })
      .expect(200);
  });

  it('condition sin type → sigue permitido (200) — el guard solo actúa junto a type=SERVICE', async () => {
    await request(app.getHttpServer())
      .get('/api/search')
      .query({ category: categorySlug, condition: 'GOOD' })
      .expect(200);
  });
});
