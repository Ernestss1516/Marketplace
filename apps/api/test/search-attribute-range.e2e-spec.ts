/**
 * BÚSQUEDA+TAGS — RÁFAGA A4: rango numérico en los filtros de atributo.
 *
 * Hasta ahora un atributo se filtraba SOLO por igualdad (`km = 120000`), que para
 * kilómetros, metros o año no sirve de nada: nadie busca un valor exacto. A4 añade
 * `km_min` / `km_max`, traducidos a `km >= n` / `km <= n` en Meilisearch.
 *
 * ADITIVO: la igualdad sigue funcionando igual, y este spec lo comprueba.
 *
 * Las categorías se crean ANTES de `createTestApp()` porque
 * FilterableAttributesResolver memoiza su mapa al arrancar (mismo patrón que
 * search-card-attributes-not-filterable y category-tree-filter-metadata): sin eso, los
 * 400 saltarían por "categoría desconocida" y pasarían por el motivo equivocado.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { MeiliSearch } from 'meilisearch';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient } from './helpers/db';
import { waitForIndex } from './helpers/meili';

describe('Búsqueda — rango numérico en atributos (A4, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let indexName: string;

  let catSlug: string;
  let sellerId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    indexName = process.env.MEILI_INDEX_NAME ?? 'listings_test';

    catSlug = `a4-rango-${Date.now()}`;
    const cat = await prisma.category.create({
      data: {
        name: 'A4 Rango', slug: catSlug,
        attributeSchema: [
          { name: 'a4Km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: false },
          { name: 'a4Cambio', label: 'Cambio', type: 'select', options: ['Manual', 'Auto'], filterable: true, required: false },
        ],
      },
    });

    app = await createTestApp();
    await app.init();

    const seller = await prisma.user.upsert({
      where: { email: 'a4-seller@example.com' },
      create: {
        email: 'a4-seller@example.com', name: 'A4 Seller', slug: 'a4-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
      update: {},
    });
    sellerId = seller.id;

    // Tres anuncios que delimitan el rango: uno por debajo, uno dentro, uno por encima.
    const stamp = Date.now();
    for (const [etiqueta, km] of [['bajo', 40_000], ['medio', 100_000], ['alto', 200_000]] as const) {
      const l = await prisma.listing.create({
        data: {
          title: `A4 ${etiqueta} ${stamp}`, slug: `a4-${etiqueta}-${stamp}`,
          description: 'x', price: 1000, type: 'PRODUCT', condition: 'GOOD',
          status: 'ACTIVE', publishedAt: new Date(),
          sellerId, categoryId: cat.id,
          attributes: { a4Km: km, a4Cambio: 'Manual' },
        },
      });
      ids[etiqueta] = l.id;
    }

    // Indexado directo (sin pasar por el wizard): lo que se prueba es el FILTRO.
    const { SearchService, INDEX_INCLUDE } = await import('src/modules/search/search.service');
    const search = app.get(SearchService);
    for (const id of Object.values(ids)) {
      const listing = await prisma.listing.findUniqueOrThrow({ where: { id }, include: INDEX_INCLUDE });
      await search.indexListing(listing);
    }
    for (const id of Object.values(ids)) await waitForIndex(meili, indexName, id);
  }, 90_000);

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { category: { slug: catSlug } } });
    await prisma.category.deleteMany({ where: { slug: catSlug } });
    await app.close();
    await prisma.$disconnect();
  });

  const buscar = (qs: string) =>
    request(app.getHttpServer()).get(`/api/search?category=${catSlug}&${qs}`);

  const titulos = (body: { hits: { title: string }[] }) => body.hits.map((h) => h.title).sort();

  // ── El rango ────────────────────────────────────────────────────────────────

  it('rango CERRADO: km_min + km_max deja solo lo que cae dentro', async () => {
    const res = await buscar('a4Km_min=50000&a4Km_max=150000').expect(200);
    expect(res.body.totalHits).toBe(1);
    expect(titulos(res.body)[0]).toContain('medio');
  });

  it('rango ABIERTO por arriba: solo km_min es "50000 o más"', async () => {
    const res = await buscar('a4Km_min=50000').expect(200);
    expect(res.body.totalHits).toBe(2);
    expect(titulos(res.body).join()).toMatch(/alto.*medio|medio.*alto/);
  });

  it('rango ABIERTO por abajo: solo km_max es "hasta 150000"', async () => {
    const res = await buscar('a4Km_max=150000').expect(200);
    expect(res.body.totalHits).toBe(2);
    expect(titulos(res.body).join()).toMatch(/bajo.*medio|medio.*bajo/);
  });

  it('los extremos son INCLUSIVOS (>= y <=, no > y <)', async () => {
    const res = await buscar('a4Km_min=100000&a4Km_max=100000').expect(200);
    expect(res.body.totalHits).toBe(1);
    expect(titulos(res.body)[0]).toContain('medio');
  });

  // ── La igualdad NO se rompe (requisito de oro) ──────────────────────────────

  it('LA IGUALDAD SIGUE VIVA: km=100000 devuelve el exacto', async () => {
    const res = await buscar('a4Km=100000').expect(200);
    expect(res.body.totalHits).toBe(1);
    expect(titulos(res.body)[0]).toContain('medio');
  });

  it('igualdad que no casa con nada devuelve 0, no error', async () => {
    const res = await buscar('a4Km=99999').expect(200);
    expect(res.body.totalHits).toBe(0);
  });

  it('rango e igualdad se pueden combinar (ambas cláusulas, AND)', async () => {
    // Coherentes → el anuncio; contradictorias → ninguno. Se prueban las dos.
    expect((await buscar('a4Km=100000&a4Km_min=50000').expect(200)).body.totalHits).toBe(1);
    expect((await buscar('a4Km=100000&a4Km_min=150000').expect(200)).body.totalHits).toBe(0);
  });

  it('el rango convive con otro filtro de atributo', async () => {
    expect((await buscar('a4Km_min=50000&a4Cambio=Manual').expect(200)).body.totalHits).toBe(2);
    expect((await buscar('a4Km_min=50000&a4Cambio=Auto').expect(200)).body.totalHits).toBe(0);
  });

  // ── Validación ──────────────────────────────────────────────────────────────

  it('_min/_max sobre un atributo NO numérico → 400', async () => {
    const res = await buscar('a4Cambio_min=3').expect(400);
    expect(JSON.stringify(res.body)).toMatch(/numéricos|numericos/i);
  });

  it('_min/_max sobre un atributo AJENO a la categoría → 400 (anti-leak intacto)', async () => {
    await buscar('roomsQueNoExiste_min=3').expect(400);
  });

  it('un valor no numérico en el rango → 400', async () => {
    await buscar('a4Km_min=muchos').expect(400);
  });

  it('min > max → 400 (es un error del cliente, no una búsqueda vacía)', async () => {
    const res = await buscar('a4Km_min=200000&a4Km_max=100000').expect(400);
    expect(JSON.stringify(res.body)).toMatch(/no puede ser mayor/i);
  });

  it('min == max se acepta (es el rango de un solo punto, ya probado arriba)', async () => {
    await buscar('a4Km_min=100000&a4Km_max=100000').expect(200);
  });
});
