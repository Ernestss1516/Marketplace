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
import { ESTADOS_EN_VUELO, getExistingJobs } from './helpers/queue';
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

  // ---------------------------------------------------------------------------
  // B.1 — Featured listing expiration
  // ---------------------------------------------------------------------------

  describe('B.1 — FEATURED_LISTING expiration', () => {
    it('sets revokedAt on the entitlement and enqueues reindex for the listing', async () => {
      const user = await createUser(`b1-basic-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.ACTIVE);
      const entitlement = await createExpiredFeaturedEntitlement(user.id, listing.id);

      await expirationService.runExpirationSweep();

      // revokedAt must be set
      const updated = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
      expect(updated.revokedAt).not.toBeNull();

      // The BullMQ job must exist for this listing
      const jobs = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const job = jobs.find((j) => j.data?.listingId === listing.id);
      expect(job).toBeDefined();
    });

    it('does NOT enqueue reindex for a non-ACTIVE listing (SOLD)', async () => {
      const user = await createUser(`b1-sold-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.SOLD);
      await createExpiredFeaturedEntitlement(user.id, listing.id);

      const jobsBefore = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countBefore = jobsBefore.filter((j) => j.data?.listingId === listing.id).length;

      await expirationService.runExpirationSweep();

      const jobsAfter = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countAfter = jobsAfter.filter((j) => j.data?.listingId === listing.id).length;

      expect(countAfter).toBe(countBefore); // no new jobs
    });

    it('IDEMPOTENCY: second sweep does NOT re-process already-revoked entitlements', async () => {
      const user = await createUser(`b1-idem-${Date.now()}`);
      const listing = await createListing(user.id, ListingStatus.ACTIVE);
      const entitlement = await createExpiredFeaturedEntitlement(user.id, listing.id);

      // First sweep
      await expirationService.runExpirationSweep();

      const jobsAfterFirst = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countAfterFirst = jobsAfterFirst.filter((j) => j.data?.listingId === listing.id).length;

      // Second sweep — revokedAt is already set, so this entitlement is excluded
      await expirationService.runExpirationSweep();

      const jobsAfterSecond = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countAfterSecond = jobsAfterSecond.filter((j) => j.data?.listingId === listing.id).length;

      // BullMQ deduplicates by jobId, so count stays the same
      expect(countAfterSecond).toBe(countAfterFirst);

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
      const listings: string[] = [];
      for (let i = 0; i < 7; i++) {
        const l = await createListing(user.id, ListingStatus.ACTIVE, (7 - i) * 60 * 1000);
        listings.push(l.id);
      }
      await createExpiredProEntitlement(user.id, 10);

      const jobsBefore = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countBefore = jobsBefore.filter((j) => listings.includes(j.data?.listingId as string)).length;

      await expirationService.runExpirationSweep();

      // The 2 oldest listings are now DRAFT; reindex jobs must exist for them
      const jobsAfter = await getExistingJobs(indexingQueue, ESTADOS_EN_VUELO);
      const countAfter = jobsAfter.filter((j) => listings.includes(j.data?.listingId as string)).length;

      // At least 2 new jobs were enqueued (one per drafted listing)
      expect(countAfter - countBefore).toBeGreaterThanOrEqual(2);

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
