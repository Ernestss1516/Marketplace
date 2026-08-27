/**
 * RF.7-B — Entitlement expiration cron (e2e)
 *
 * Tests EntitlementExpirationService.runExpirationSweep() directly (no clock
 * required — entitlements with expiresAt in the past are injected via Prisma).
 *
 * Covers:
 *   B.1  — FEATURED_LISTING expiry: revokedAt set + reindex job enqueued
 *   B.1  — Non-active listing is skipped (no reindex for SOLD/EXPIRED listings)
 *   B.1  — Idempotency: second sweep does NOT re-enqueue already-revoked entitlements
 *   B.2  — PRO downgrade: 8 active → 3 moved to DRAFT, 5 remain ACTIVE (oldest first)
 *   B.2  — Grace period: PRO expired <7 days ago → no downgrade yet
 *   B.2  — Idempotency: second sweep does NOT move more listings to DRAFT
 *   B.2  — User who renewed Pro before downgrade is skipped
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
// `getJobs` de BullMQ puede devolver huecos cuando el worker completa un job
// mientras se lee (`removeOnComplete: true`). Ver `helpers/queue.ts`.
import { ESTADOS_EN_VUELO, conColaPausada, getExistingJobs } from './helpers/queue';
import { EntitlementExpirationService } from 'src/modules/expiration/entitlement-expiration.service';
import { QUEUE_INDEXING } from 'src/infra/queue/queue.constants';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RF.7-B — Entitlement expiration cron (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let expirationService: EntitlementExpirationService;
  let indexingQueue: Queue;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    expirationService = app.get(EntitlementExpirationService);
    indexingQueue = app.get<Queue>(getQueueToken(QUEUE_INDEXING));

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createUser(suffix: string) {
    return prisma.user.create({
      data: {
        email: `rf7b-${suffix}@example.com`,
        name: `RF7B ${suffix}`,
        slug: `rf7b-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
  }

  async function createListing(userId: string, status: ListingStatus, offsetMs = 0) {
    return prisma.listing.create({
      data: {
        title: `Listing ${Date.now()} ${Math.random()}`,
        slug: `listing-rf7b-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'desc',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId: userId,
        categoryId,
        publishedAt: status === ListingStatus.ACTIVE
          ? new Date(Date.now() - offsetMs)
          : undefined,
      },
    });
  }

  async function createExpiredFeaturedEntitlement(userId: string, listingId: string) {
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        expiresAt: pastDate,
        revokedAt: null,
      },
    });
  }

  async function createExpiredProEntitlement(userId: string, daysAgo: number) {
    const pastDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: pastDate,
      },
    });
  }

  /** La fecha UTC con la que el productor compone el `jobId`. */
  const fechaUtc = () => new Date().toISOString().slice(0, 10);

  /**
   * Corre el barrido y devuelve las fechas UTC con las que HA PODIDO componer el
   * `jobId` (`feat-exp-<entId>-<YYYY-MM-DD>`, servicio línea 85).
   *
   * Se anota a los DOS lados de la llamada porque el servicio calcula su `today`
   * por dentro: si el barrido cruzara la medianoche UTC, reconstruir el id con una
   * sola fecha fallaría. Pasa una vez cada muchos años y dura milisegundos — que es
   * exactamente la forma de las carreras que esta ráfaga viene a cerrar, así que no
   * se cambia una por otra.
   */
  async function ejecutarBarridoAnotandoFecha(): Promise<string[]> {
    const antes = fechaUtc();
    await expirationService.runExpirationSweep();
    const despues = fechaUtc();
    return [...new Set([antes, despues])];
  }

  /** El job de caducidad de destacado de ese entitlement, si existe. */
  async function buscarJobFeatExp(entitlementId: string, fechas: string[]) {
    const encontrados = await Promise.all(
      fechas.map((f) => indexingQueue.getJob(`feat-exp-${entitlementId}-${f}`)),
    );
    return encontrados.find(Boolean);
  }

  // ---------------------------------------------------------------------------
  // B.1 — Featured listing expiration
  // ---------------------------------------------------------------------------

  describe('B.1 — FEATURED_LISTING expiration', () => {
    it('sets revokedAt on the entitlement and enqueues reindex for the listing', async () => {
      const user = await createUser(`b1-basic-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.ACTIVE);
      const entitlement = await createExpiredFeaturedEntitlement(user.id, listing.id);

      // La cola PARADA mientras se barre y se lee: `expireFeaturedListings` encola
      // con `removeOnComplete: true` y el worker está vivo, así que sin la pausa
      // este `getJob` es una apuesta a llegar antes que él. Ver `helpers/queue.ts`.
      const job = await conColaPausada(indexingQueue, async () => {
        const fechasCandidatas = await ejecutarBarridoAnotandoFecha();

        // revokedAt must be set
        const updated = await prisma.entitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        });
        expect(updated.revokedAt).not.toBeNull();

        // POR jobId, que es DETERMINISTA (`feat-exp-<entId>-<YYYY-MM-DD>`, ver
        // entitlement-expiration.service.ts:85) y por tanto dice más que «hay un job
        // para este anuncio»: dice que es EL job de ESTE entitlement, el mismo que
        // el productor usa para deduplicar.
        return buscarJobFeatExp(entitlement.id, fechasCandidatas);
      });

      expect(job).toBeDefined();
      expect(job!.data?.listingId).toBe(listing.id);
    });

    it('does NOT enqueue reindex for a non-ACTIVE listing (SOLD)', async () => {
      const user = await createUser(`b1-sold-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.SOLD);
      const entitlement = await createExpiredFeaturedEntitlement(user.id, listing.id);

      // AUSENCIA POR IDENTIDAD, no por conteo.
      //
      // Esto comparaba un `countBefore` con un `countAfter` filtrados por
      // `listingId`, y el conteo nunca fue lo que se quería afirmar: lo que prueba
      // este caso es que para ESTE anuncio no aparece NINGÚN job. Con la cola
      // parada, «ninguno» es una afirmación estable; sin ella, un cero podía venir
      // de que el worker se hubiera llevado el job que sí se encoló —o sea, el test
      // pasaba en verde justo cuando el defecto que vigila estaba presente—.
      await conColaPausada(indexingQueue, async () => {
        const fechasCandidatas = await ejecutarBarridoAnotandoFecha();

        expect(await buscarJobFeatExp(entitlement.id, fechasCandidatas)).toBeUndefined();

        const jobs = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
        expect(jobs.filter((j) => j.data?.listingId === listing.id)).toHaveLength(0);
      });
    });

    it('IDEMPOTENCY: second sweep does NOT re-process already-revoked entitlements', async () => {
      const user = await createUser(`b1-idem-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.ACTIVE);
      const entitlement = await createExpiredFeaturedEntitlement(user.id, listing.id);

      await conColaPausada(indexingQueue, async () => {
        const fechas = await ejecutarBarridoAnotandoFecha();
        const primero = await buscarJobFeatExp(entitlement.id, fechas);
        expect(primero).toBeDefined();

        // Second sweep — revokedAt is already set, so this entitlement is excluded
        await ejecutarBarridoAnotandoFecha();

        const segundo = await buscarJobFeatExp(entitlement.id, fechas);
        expect(segundo).toBeDefined();

        // EL MISMO JOB, no otro con la misma pinta.
        //
        // El `timestamp` es la hora de CREACIÓN del job: si el segundo barrido
        // hubiera encolado de nuevo, habría un job nuevo y el sello cambiaría. Que
        // no cambie es la garantía de deduplicación que promete el productor
        // (entitlement-expiration.service.ts:80-81), afirmada directamente.
        //
        // Antes esto comparaba dos conteos, que probaban lo mismo de refilón y sólo
        // mientras nada más tocara la cola.
        expect(segundo!.id).toBe(primero!.id);
        expect(segundo!.timestamp).toBe(primero!.timestamp);
      });

      // revokedAt still set (not cleared)
      const ent = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
      expect(ent.revokedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // B.2 — Pro → Free downgrade
  // ---------------------------------------------------------------------------

  describe('B.2 — PRO_SUBSCRIPTION downgrade', () => {
    it('moves the oldest excess listings to DRAFT when user has more than freeLimit active', async () => {
      const user = await createUser(`b2-excess-${Date.now()}`);

      // Create 8 ACTIVE listings with staggered publishedAt (oldest = largest offsetMs)
      const listings: { id: string; publishedAt: Date }[] = [];
      for (let i = 0; i < 8; i++) {
        const l = await createListing(user.id, ListingStatus.ACTIVE, (8 - i) * 60 * 1000);
        const fetched = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
        listings.push({ id: fetched.id, publishedAt: fetched.publishedAt! });
      }

      // Sort to identify the 3 oldest (they should go to DRAFT)
      listings.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
      const expectedDraft = listings.slice(0, 3).map((l) => l.id); // 3 oldest
      const expectedActive = listings.slice(3).map((l) => l.id);   // 5 newest

      await createExpiredProEntitlement(user.id, 10); // expired 10 days ago (> 7 grace)

      await expirationService.runExpirationSweep();

      // Read the free limit from DB
      const setting = await prisma.setting.findUnique({ where: { key: 'freeActiveListingLimit' } });
      const freeLimit = setting ? Number(setting.value) : 5;
      expect(freeLimit).toBe(5);

      // Verify state
      for (const id of expectedDraft) {
        const l = await prisma.listing.findUniqueOrThrow({ where: { id } });
        expect(l.status).toBe(ListingStatus.DRAFT);
      }
      for (const id of expectedActive) {
        const l = await prisma.listing.findUniqueOrThrow({ where: { id } });
        expect(l.status).toBe(ListingStatus.ACTIVE);
      }
    });

    it('does NOT downgrade when PRO expired less than 7 days ago (in grace period)', async () => {
      const user = await createUser(`b2-grace-${Date.now()}`);
      await createListing(user.id, ListingStatus.ACTIVE);
      await createListing(user.id, ListingStatus.ACTIVE);
      await createListing(user.id, ListingStatus.ACTIVE);
      await createListing(user.id, ListingStatus.ACTIVE);
      await createListing(user.id, ListingStatus.ACTIVE);
      await createListing(user.id, ListingStatus.ACTIVE); // 6 active

      // PRO expired only 3 days ago — still within grace period
      await createExpiredProEntitlement(user.id, 3);

      await expirationService.runExpirationSweep();

      const activeCount = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      expect(activeCount).toBe(6); // all still active
    });

    it('IDEMPOTENCY: second sweep does not move more listings to DRAFT', async () => {
      const user = await createUser(`b2-idem-${Date.now()}`);

      for (let i = 0; i < 8; i++) {
        await createListing(user.id, ListingStatus.ACTIVE, (8 - i) * 60 * 1000);
      }
      await createExpiredProEntitlement(user.id, 10);

      // First sweep
      await expirationService.runExpirationSweep();

      const activeAfterFirst = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      const draftAfterFirst = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.DRAFT },
      });
      expect(activeAfterFirst).toBe(5);
      expect(draftAfterFirst).toBe(3);

      // Second sweep
      await expirationService.runExpirationSweep();

      const activeAfterSecond = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      const draftAfterSecond = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.DRAFT },
      });
      expect(activeAfterSecond).toBe(5); // unchanged
      expect(draftAfterSecond).toBe(3);  // unchanged
    });

    it('skips a user who renewed their Pro before the downgrade sweep ran', async () => {
      const user = await createUser(`b2-renewed-${Date.now()}`);

      for (let i = 0; i < 8; i++) {
        await createListing(user.id, ListingStatus.ACTIVE);
      }

      // Old expired subscription (>7 days ago)
      await createExpiredProEntitlement(user.id, 10);

      // New active Pro subscription
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.entitlement.create({
        data: {
          userId: user.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          expiresAt: futureDate,
        },
      });

      await expirationService.runExpirationSweep();

      // All 8 listings remain active — user is still Pro
      const activeCount = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      expect(activeCount).toBe(8);
    });

    it('does nothing when user has 5 or fewer active listings after PRO expired', async () => {
      const user = await createUser(`b2-within-limit-${Date.now()}`);

      for (let i = 0; i < 4; i++) {
        await createListing(user.id, ListingStatus.ACTIVE);
      }
      await createExpiredProEntitlement(user.id, 10);

      await expirationService.runExpirationSweep();

      const activeCount = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      expect(activeCount).toBe(4); // unchanged, already within free limit
    });

    it('enqueues reindex jobs for downgraded-to-DRAFT listings (Meilisearch removal)', async () => {
      const user = await createUser(`b2-reindex-${Date.now()}`);

      // 7 active listings — 2 will go to DRAFT (excess over free limit of 5)
      // `offsetMs` se resta de `publishedAt`, así que el i=0 es el MÁS VIEJO: los
      // dos primeros del array son los que el degradado tiene que bajar a DRAFT.
      const listings: string[] = [];
      for (let i = 0; i < 7; i++) {
        const l = await createListing(user.id, ListingStatus.ACTIVE, (7 - i) * 60 * 1000);
        listings.push(l.id);
      }
      const esperadosEnDraft = listings.slice(0, 2);
      await createExpiredProEntitlement(user.id, 10);

      // AQUÍ NO HAY jobId QUE MIRAR: el degradado encola con
      // `indexingQueue.add('index', { listingId })` a secas (servicio línea 182),
      // sin `jobId`, así que BullMQ le pone uno autoincremental. Reconstruirlo desde
      // el test es imposible, y añadirle un `jobId` al productor para que un test
      // pueda afirmar sería tocar producción por comodidad del test.
      //
      // La aserción honesta con lo que hay: bajo la cola parada, existe un job para
      // cada uno de los anuncios que han caído a DRAFT — identidad por DATO, no
      // conteo. El `countAfter - countBefore >= 2` de antes dependía de que ningún
      // job ajeno se completara entre las dos lecturas, y además no comprobaba
      // CUÁLES eran los dos.
      const degradados = await conColaPausada(indexingQueue, async () => {
        await expirationService.runExpirationSweep();

        const jobs = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
        const conJob = new Set(jobs.map((j) => j.data?.listingId as string));
        return listings.filter((id) => conJob.has(id));
      });

      // The 2 oldest listings are now DRAFT; reindex jobs must exist for them
      expect([...degradados].sort()).toEqual([...esperadosEnDraft].sort());

      // Confirm the 2 oldest are DRAFT and the 5 newest are still ACTIVE
      const draftCount = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.DRAFT },
      });
      const activeCount = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      expect(draftCount).toBe(2);
      expect(activeCount).toBe(5);
    });
  });
});
