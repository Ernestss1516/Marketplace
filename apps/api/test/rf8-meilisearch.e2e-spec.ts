/**
 * RF.8 — Meilisearch: boostScore (featured ranking) + sortDate (bump recency)
 *
 * Covers:
 *  1. Featured listing (boostScore=1) ranks above non-featured in a relevant search.
 *  2. Featured listing does NOT pollute unrelated searches (textual relevance preserved).
 *  3. After revoking the entitlement (boostScore→0, as the B.1 cron does), ranking reverts.
 *     Note: in production the B.1 cron triggers this re-index; here we invoke SearchService
 *     directly to test the ranking mechanic without waiting for the cron.
 *  4. sortDate = max(publishedAt, bumpedAt): bump resurfaces (D before C); re-indexing
 *     without touching bumpedAt (simulating renew) does NOT change the order.
 *
 * All listings are created directly in Prisma (status=ACTIVE) and indexed via SearchService
 * to bypass BullMQ timing. Entitlements are injected via Prisma — no payment gateway needed.
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

/** Polls until doc[field] === expected or timeout. */
async function waitForDocumentField(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  field: string,
  expected: unknown,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const doc = (await client.index(indexName).getDocument(docId)) as Record<string, unknown>;
      if (doc[field] === expected) return;
    } catch { /* not yet indexed */ }
    await new Promise<void>((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Document "${docId}" field "${field}" did not reach ${JSON.stringify(expected)} within ${timeoutMs} ms`,
  );
}

/** Polls until doc[field] (numeric) exceeds threshold. */
async function waitForFieldGreaterThan(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  field: string,
  threshold: number,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const doc = (await client.index(indexName).getDocument(docId)) as Record<string, unknown>;
      if (typeof doc[field] === 'number' && (doc[field] as number) > threshold) return;
    } catch { /* not yet indexed */ }
    await new Promise<void>((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Document "${docId}" field "${field}" did not exceed ${threshold} within ${timeoutMs} ms`,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RF.8 — Meilisearch boostScore + sortDate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let searchService: SearchService;
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    searchService = app.get(SearchService);

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'rf8-seller@example.com',
        name: 'RF8 Seller',
        slug: 'rf8-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createActiveListing(title: string, publishedAt: Date, bumpedAt: Date | null = null) {
    const slug = `rf8-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return prisma.listing.create({
      data: {
        title,
        slug,
        description: title,
        price: new Prisma.Decimal('100.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        categoryId,
        sellerId: userId,
        publishedAt,
        bumpedAt,
      },
    });
  }

  async function createFeaturedEntitlement(listingId: string, active = true) {
    const expiresAt = active
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
      : new Date(Date.now() - 1_000);                   // already expired
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        expiresAt,
        revokedAt: null,
      },
    });
  }

  /** Re-fetches the listing from Postgres (with entitlements) and pushes it to Meilisearch. */
  async function fetchAndIndex(listingId: string) {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchService.indexListing(listing as any);
  }

  // ---------------------------------------------------------------------------
  // boostScore tests
  // ---------------------------------------------------------------------------

  describe('boostScore — featured ranking', () => {
    let listingAId: string; // featured
    let listingBId: string; // not featured

    beforeAll(async () => {
      const now = Date.now();
      // A published slightly before B so that without boostScore, B would win on sortDate.
      const [A, B] = await Promise.all([
        createActiveListing('TelefonoRF8Boost Modelo Pro', new Date(now - 2_000)),
        createActiveListing('TelefonoRF8Boost Modelo Lite', new Date(now - 1_000)),
      ]);
      listingAId = A.id;
      listingBId = B.id;

      // Grant A a featured entitlement (boostScore = 1 after re-index).
      await createFeaturedEntitlement(listingAId);

      await fetchAndIndex(listingAId);
      await fetchAndIndex(listingBId);

      // Wait for Meilisearch to reflect both documents with the correct boostScore.
      await waitForDocumentField(meili, INDEX_NAME, listingAId, 'boostScore', 1);
      await waitForDocumentField(meili, INDEX_NAME, listingBId, 'boostScore', 0);
    }, 30_000);

    it('destacado (boostScore=1) entra al bloque "featured" pero NO reordena la lista principal (política C)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'TelefonoRF8Boost' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      const featured = res.body.featured as { id: string }[];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      // boostScore ya NO está en las ranking rules (RÁFAGA 1): sin él, el desempate final
      // es sortDate:desc — B (publicado 1s más tarde) queda por delante de A en la LISTA,
      // aunque A esté destacado. El boost ya no particiona el orden de la lista.
      expect(hits[0].id).toBe(listingBId);
      // A sí entra al bloque de "Promocionados" — la promoción de pago vive ahí, no reordenando la lista.
      expect(featured.some((h) => h.id === listingAId)).toBe(true);
      expect(featured.some((h) => h.id === listingBId)).toBe(false);
    });

    it('destacado NO aparece en búsquedas con query irrelevante (boost no contamina)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'nevera_industrial_xq7w_inexistente' })
        .expect(200);

      // Boost only helps within results already matched by text; an unrelated query returns 0.
      expect(res.body.totalHits).toBe(0);
    });

    it('boostScore vuelve a 0 al revocar el entitlement → B aparece antes que A', async () => {
      // Simulate the B.1 expiration cron: revoke the entitlement.
      await prisma.entitlement.updateMany({
        where: { listingId: listingAId, type: EntitlementType.FEATURED_LISTING },
        data: { revokedAt: new Date() },
      });

      // Re-index A — entitlement is now revoked → INDEX_INCLUDE filter excludes it → boostScore=0.
      await fetchAndIndex(listingAId);
      await waitForDocumentField(meili, INDEX_NAME, listingAId, 'boostScore', 0);

      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'TelefonoRF8Boost' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      const featured = res.body.featured as { id: string }[];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      // A (boostScore=0, published 2s earlier) vs B (boostScore=0, published 1s earlier).
      // sortDate tiebreaker: B has higher sortDate → B appears first.
      expect(hits[0].id).toBe(listingBId);
      // Neither is boosted anymore — the "Promocionados" block is empty for this query.
      expect(featured.some((h) => h.id === listingAId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // sortDate tests
  // ---------------------------------------------------------------------------

  describe('sortDate — bump resurfaces, renew does not', () => {
    let listingCId: string; // published 2 days ago, no bump
    let listingDId: string; // published 3 days ago, no bump initially

    const T_MID = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
    const T_OLD = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago

    beforeAll(async () => {
      const [C, D] = await Promise.all([
        createActiveListing('AutomovilRF8Sort Seat', new Date(T_MID)), // C: 2d ago
        createActiveListing('AutomovilRF8Sort Ford', new Date(T_OLD)), // D: 3d ago (older)
      ]);
      listingCId = C.id;
      listingDId = D.id;

      await fetchAndIndex(listingCId);
      await fetchAndIndex(listingDId);

      // Both indexed with boostScore=0 (no entitlements).
      await waitForDocumentField(meili, INDEX_NAME, listingCId, 'boostScore', 0);
      await waitForDocumentField(meili, INDEX_NAME, listingDId, 'boostScore', 0);
    }, 30_000);

    it('orden inicial: C (más reciente) antes que D (más antiguo) con sort=sortDate:desc', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'AutomovilRF8Sort', sort: 'sortDate:desc' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      const cIdx = hits.findIndex((h) => h.id === listingCId);
      const dIdx = hits.findIndex((h) => h.id === listingDId);
      expect(cIdx).toBeLessThan(dIdx); // C before D initially
    });

    it('bump de D (bumpedAt=now) → D aparece antes que C en sortDate:desc', async () => {
      await prisma.listing.update({
        where: { id: listingDId },
        data: { bumpedAt: new Date() },
      });

      await fetchAndIndex(listingDId);
      // D's sortDate = max(T_OLD, now) = now, which must exceed T_MID (C's sortDate).
      await waitForFieldGreaterThan(meili, INDEX_NAME, listingDId, 'sortDate', T_MID);

      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'AutomovilRF8Sort', sort: 'sortDate:desc' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      const dIdx = hits.findIndex((h) => h.id === listingDId);
      const cIdx = hits.findIndex((h) => h.id === listingCId);
      expect(dIdx).toBeLessThan(cIdx); // D before C after bump
    });

    it('renew de C (sin cambio de bumpedAt) → D sigue antes que C (sortDate no cambia)', async () => {
      // Simulate renew: re-index C without updating publishedAt or bumpedAt.
      // This is exactly what the renew flow does (preserves both timestamps).
      await fetchAndIndex(listingCId);

      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'AutomovilRF8Sort', sort: 'sortDate:desc' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      const dIdx = hits.findIndex((h) => h.id === listingDId);
      const cIdx = hits.findIndex((h) => h.id === listingCId);
      expect(dIdx).toBeLessThan(cIdx); // D still before C — renew did not change sortDate
    });
  });

  // ---------------------------------------------------------------------------
  // RP.4 — priceUnit indexado, filtrable y facetable
  // ---------------------------------------------------------------------------

  describe('priceUnit — formato de precio en el índice (RP.4)', () => {
    let hourId: string;
    let monthId: string;
    let oneTimeId: string;

    beforeAll(async () => {
      async function createWithUnit(title: string, priceUnit: 'ONE_TIME' | 'PER_HOUR' | 'PER_MONTH') {
        const listing = await prisma.listing.create({
          data: {
            title,
            slug: `rf8pu-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            description: title,
            price: new Prisma.Decimal('30.00'),
            currency: 'EUR',
            type: 'SERVICE',
            priceType: 'FIXED',
            priceUnit,
            status: ListingStatus.ACTIVE,
            categoryId,
            sellerId: userId,
            publishedAt: new Date(),
          },
        });
        await fetchAndIndex(listing.id);
        return listing.id;
      }

      hourId = await createWithUnit('ClaseParticularRF8PU por horas', 'PER_HOUR');
      monthId = await createWithUnit('ClaseParticularRF8PU mensual', 'PER_MONTH');
      oneTimeId = await createWithUnit('ClaseParticularRF8PU suelta', 'ONE_TIME');

      await waitForDocumentField(meili, INDEX_NAME, hourId, 'priceUnit', 'PER_HOUR');
      await waitForDocumentField(meili, INDEX_NAME, monthId, 'priceUnit', 'PER_MONTH');
      await waitForDocumentField(meili, INDEX_NAME, oneTimeId, 'priceUnit', 'ONE_TIME');
    }, 40_000);

    it('el documento indexado incluye priceUnit', async () => {
      const doc = (await meili.index(INDEX_NAME).getDocument(hourId)) as Record<string, unknown>;
      expect(doc.priceUnit).toBe('PER_HOUR');
    });

    it('los anuncios sin formato explícito se indexan como ONE_TIME (default de la columna)', async () => {
      const doc = (await meili.index(INDEX_NAME).getDocument(oneTimeId)) as Record<string, unknown>;
      expect(doc.priceUnit).toBe('ONE_TIME');
    });

    it('filtrar por priceUnit=PER_HOUR devuelve SOLO los de por horas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU', priceUnit: 'PER_HOUR' })
        .expect(200);

      const hits = res.body.hits as { id: string; priceUnit: string }[];
      expect(hits.length).toBe(1);
      expect(hits[0].id).toBe(hourId);
      expect(hits.every((h) => h.priceUnit === 'PER_HOUR')).toBe(true);
    });

    it('filtrar por priceUnit=PER_MONTH devuelve solo el mensual', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU', priceUnit: 'PER_MONTH' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      expect(hits.length).toBe(1);
      expect(hits[0].id).toBe(monthId);
    });

    it('sin filtro de priceUnit salen los tres (el filtro es opcional)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU' })
        .expect(200);

      expect((res.body.hits as unknown[]).length).toBe(3);
    });

    it('priceUnit viaja como faceta con su reparto de valores', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU' })
        .expect(200);

      const facets = res.body.facets as Record<string, Record<string, number>>;
      expect(facets.priceUnit).toBeDefined();
      expect(facets.priceUnit.PER_HOUR).toBe(1);
      expect(facets.priceUnit.PER_MONTH).toBe(1);
      expect(facets.priceUnit.ONE_TIME).toBe(1);
    });

    it('priceUnit y priceType son ejes independientes: se combinan sin pisarse', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU', priceType: 'FIXED', priceUnit: 'PER_HOUR' })
        .expect(200);

      const hits = res.body.hits as { id: string }[];
      expect(hits.length).toBe(1);
      expect(hits[0].id).toBe(hourId);
    });

    it('un priceUnit fuera del enum → 400 (validado por el DTO, no tratado como atributo)', async () => {
      await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'ClaseParticularRF8PU', priceUnit: 'PER_FORTNIGHT' })
        .expect(400);
    });
  });
});
