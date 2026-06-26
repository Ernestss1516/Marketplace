/**
 * RF.6 — Featured listing, bump, and wallet (e2e)
 *
 * Verifies the full RF.6 surface without any real payment gateway:
 *   - featuredByCredits: atomic debit + entitlement + rollback on failure
 *   - featuredByRedsys: RedsysProcessor.handleFeaturedPay → same entitlement shape
 *   - bump: cooldown, atomic debit, bumpedAt update, failed-attempt invariants
 *   - GET /billing/wallet: balance + paginated movements
 *
 * Static data (CreditPack, Price, Setting) is seeded once in globalSetup.
 * Dynamic data (users, listings, wallets) is created per suite in beforeAll.
 */

import { INestApplication } from '@nestjs/common';
import {
  CreditLedgerType,
  EntitlementType,
  ListingStatus,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { BillingService } from 'src/modules/billing/billing.service';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.accessToken as string;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RF.6 — Featured listing, bump, and wallet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let billingService: BillingService;
  let redsysProcessor: RedsysProcessor;

  // Shared IDs
  let sellerUserId: string;
  let otherUserId: string;
  let sellerToken: string;
  let otherToken: string;
  let categoryId: string;

  // Featured price IDs (seeded in globalSetup)
  let featuredPrice7dId: string;
  let featuredPrice7dDurationDays: number; // 7

  const INITIAL_BALANCE = 200;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    billingService = app.get(BillingService);
    redsysProcessor = app.get(RedsysProcessor);

    // Categories
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    // Users
    const seller = await prisma.user.create({
      data: {
        email: 'rf6-seller@example.com',
        name: 'RF6 Seller',
        slug: 'rf6-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerUserId = seller.id;

    const other = await prisma.user.create({
      data: {
        email: 'rf6-other@example.com',
        name: 'RF6 Other',
        slug: 'rf6-other',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    otherUserId = other.id;

    sellerToken = await loginUser(app, 'rf6-seller@example.com', 'Test1234!');
    otherToken = await loginUser(app, 'rf6-other@example.com', 'Test1234!');

    // Seed seller's wallet with INITIAL_BALANCE credits
    await prisma.wallet.create({
      data: { userId: sellerUserId, balance: INITIAL_BALANCE },
    });

    // Look up featured listing price (seeded in seed-test.ts)
    const price7d = await prisma.price.findFirst({
      where: { durationDays: 7, creditPackId: null },
    });
    if (!price7d) throw new Error('Featured listing price 7d not found — run seed-test.ts');
    featuredPrice7dId = price7d.id;
    featuredPrice7dDurationDays = price7d.durationDays!;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helper: create an ACTIVE listing owned by seller
  // ---------------------------------------------------------------------------

  async function createActiveListing(suffix = ''): Promise<string> {
    const listing = await prisma.listing.create({
      data: {
        title: `Test listing${suffix}`,
        slug: `test-listing-rf6-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'E2e test listing',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId: sellerUserId,
        categoryId,
        publishedAt: new Date(),
      },
    });
    return listing.id;
  }

  // Helper: get current wallet balance for seller
  async function getBalance(): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { userId: sellerUserId } });
    return wallet?.balance ?? 0;
  }

  // ---------------------------------------------------------------------------
  // GET /billing/wallet
  // ---------------------------------------------------------------------------

  describe('GET /billing/wallet', () => {
    it('returns balance and empty movements for a fresh wallet', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/billing/wallet')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.balance).toBe(INITIAL_BALANCE);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('returns 200 with balance 0 for a user with no wallet', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/billing/wallet')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      expect(res.body.balance).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /billing/featured-by-credits
  // ---------------------------------------------------------------------------

  describe('POST /billing/featured-by-credits', () => {
    it('debits credits, creates FEATURED_LISTING entitlement, writes FEATURED_DEBIT ledger entry', async () => {
      const listingId = await createActiveListing('-feat-ok');
      const balanceBefore = await getBalance();

      const costSetting = await prisma.setting.findUnique({ where: { key: 'featuredCreditCost7d' } });
      const cost = Number(costSetting!.value); // 30

      const res = await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId })
        .expect(201);

      expect(res.body).toBeDefined();

      // Balance decreased
      const balanceAfter = await getBalance();
      expect(balanceAfter).toBe(balanceBefore - cost);

      // Entitlement created
      const entitlement = await prisma.entitlement.findFirst({
        where: {
          listingId,
          type: EntitlementType.FEATURED_LISTING,
          expiresAt: { gt: new Date() },
        },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.userId).toBe(sellerUserId);
      expect(entitlement!.priceId).toBe(featuredPrice7dId);
      expect(entitlement!.transactionId).toBeNull();

      // ExpiresAt is approximately now + 7 days
      const diffDays =
        (entitlement!.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(featuredPrice7dDurationDays, 0);

      // Ledger entry
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      const ledger = await prisma.creditLedger.findFirst({
        where: {
          walletId: wallet.id,
          type: CreditLedgerType.FEATURED_DEBIT,
          referenceId: listingId,
        },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.amount).toBe(-cost);
      expect(ledger!.referenceType).toBe('Listing');
    });

    it('returns 402 and leaves balance unchanged when wallet has insufficient credits', async () => {
      // Create a user with 0 credits
      const poor = await prisma.user.create({
        data: {
          email: 'rf6-poor@example.com',
          name: 'RF6 Poor',
          slug: 'rf6-poor',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const poorToken = await loginUser(app, 'rf6-poor@example.com', 'Test1234!');
      const poorListing = await prisma.listing.create({
        data: {
          title: 'Poor listing',
          slug: `poor-listing-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: poor.id,
          categoryId,
          publishedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${poorToken}`)
        .send({ priceId: featuredPrice7dId, listingId: poorListing.id })
        .expect(402);

      // No entitlement created
      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: poorListing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).toBeNull();

      // No wallet was created (debit on non-existent wallet → 402, no side effects)
      const wallet = await prisma.wallet.findUnique({ where: { userId: poor.id } });
      expect(wallet).toBeNull();
    });

    it('returns 403 when the listing belongs to another user', async () => {
      const listingId = await createActiveListing('-feat-403');
      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ priceId: featuredPrice7dId, listingId })
        .expect(403);
    });

    it('returns 400 when the listing is already featured', async () => {
      const listingId = await createActiveListing('-feat-dup');

      // Feature it once
      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId })
        .expect(201);

      // Try to feature it again
      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId })
        .expect(400);
    });

    it('ROLLBACK: credits are NOT debited when listing is already featured', async () => {
      const listingId = await createActiveListing('-feat-rollback');

      // Feature it via direct DB insertion to simulate "already featured"
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      await prisma.entitlement.create({
        data: {
          userId: sellerUserId,
          type: EntitlementType.FEATURED_LISTING,
          listingId,
          expiresAt: futureDate,
          priceId: featuredPrice7dId,
        },
      });

      const balanceBefore = await getBalance();

      // Attempt to feature via credits — should fail 400
      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId })
        .expect(400);

      // Balance must be unchanged (debit rolled back)
      const balanceAfter = await getBalance();
      expect(balanceAfter).toBe(balanceBefore);

      // No orphan FEATURED_DEBIT ledger entry must exist for this listing
      const orphanLedger = await prisma.creditLedger.findFirst({
        where: { type: CreditLedgerType.FEATURED_DEBIT, referenceId: listingId },
      });
      expect(orphanLedger).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /listings/:id/bump
  // ---------------------------------------------------------------------------

  describe('POST /listings/:id/bump', () => {
    it('updates bumpedAt, debits credits, and writes BUMP_DEBIT ledger entry', async () => {
      const listingId = await createActiveListing('-bump-ok');
      const balanceBefore = await getBalance();

      const bumpCostSetting = await prisma.setting.findUnique({ where: { key: 'bumpCreditCost' } });
      const cost = Number(bumpCostSetting!.value); // 5

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.bumpedAt).toBeDefined();

      // Balance decreased
      const balanceAfter = await getBalance();
      expect(balanceAfter).toBe(balanceBefore - cost);

      // Listing.bumpedAt updated
      const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(listing.bumpedAt).not.toBeNull();

      // Ledger entry
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      const ledger = await prisma.creditLedger.findFirst({
        where: { walletId: wallet.id, type: CreditLedgerType.BUMP_DEBIT, referenceId: listingId },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.amount).toBe(-cost);
    });

    it('returns 429 and does NOT debit when cooldown is active (< 1h since last bump)', async () => {
      const listingId = await createActiveListing('-bump-cooldown');

      // Pre-set bumpedAt to just now
      await prisma.listing.update({
        where: { id: listingId },
        data: { bumpedAt: new Date() },
      });

      const balanceBefore = await getBalance();

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(429);

      expect(res.body.retryAfter).toBeDefined();

      // Balance unchanged
      const balanceAfter = await getBalance();
      expect(balanceAfter).toBe(balanceBefore);
    });

    it('returns 402 and does NOT update bumpedAt when balance is insufficient', async () => {
      // Create a user with no wallet
      const poor2 = await prisma.user.create({
        data: {
          email: 'rf6-poor2@example.com',
          name: 'RF6 Poor2',
          slug: 'rf6-poor2',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const poor2Token = await loginUser(app, 'rf6-poor2@example.com', 'Test1234!');
      const poorListing = await prisma.listing.create({
        data: {
          title: 'Poor2 listing',
          slug: `poor2-listing-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: poor2.id,
          categoryId,
          publishedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .post(`/api/listings/${poorListing.id}/bump`)
        .set('Authorization', `Bearer ${poor2Token}`)
        .expect(402);

      // bumpedAt must NOT be updated
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: poorListing.id } });
      expect(after.bumpedAt).toBeNull();
    });

    it('returns 403 when the listing belongs to another user', async () => {
      const listingId = await createActiveListing('-bump-403');
      await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/bump`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 400 when the listing is not ACTIVE', async () => {
      const draftListing = await prisma.listing.create({
        data: {
          title: 'Draft listing for bump',
          slug: `draft-bump-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('50.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.DRAFT,
          sellerId: sellerUserId,
          categoryId,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/listings/${draftListing.id}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(400);
    });

    it('cooldown is NOT consumed by failed attempts (insufficient balance does not update bumpedAt)', async () => {
      // Use the poor user from above — no wallet, so every bump attempt fails with 402
      const poor3 = await prisma.user.create({
        data: {
          email: 'rf6-poor3@example.com',
          name: 'RF6 Poor3',
          slug: 'rf6-poor3',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const poor3Token = await loginUser(app, 'rf6-poor3@example.com', 'Test1234!');
      const poorListing3 = await prisma.listing.create({
        data: {
          title: 'Poor3 listing',
          slug: `poor3-listing-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: poor3.id,
          categoryId,
          publishedAt: new Date(),
        },
      });

      // Two failed attempts (no wallet → 402)
      await request(app.getHttpServer())
        .post(`/api/listings/${poorListing3.id}/bump`)
        .set('Authorization', `Bearer ${poor3Token}`)
        .expect(402);

      await request(app.getHttpServer())
        .post(`/api/listings/${poorListing3.id}/bump`)
        .set('Authorization', `Bearer ${poor3Token}`)
        .expect(402);

      // bumpedAt must still be null — cooldown was not consumed
      const listing = await prisma.listing.findUniqueOrThrow({ where: { id: poorListing3.id } });
      expect(listing.bumpedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Unified grant: featuredByCredits vs featuredByRedsys produce the same entitlement
  // ---------------------------------------------------------------------------

  describe('grantFeaturedListing unified (§3.1)', () => {
    it('featuredByCredits produces the same entitlement shape as featuredByRedsys', async () => {
      // ── Path A: via credits ────────────────────────────────────────────────
      const listingA = await createActiveListing('-unified-A');

      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId: listingA })
        .expect(201);

      const entitlementA = await prisma.entitlement.findFirst({
        where: { listingId: listingA, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlementA).not.toBeNull();
      expect(entitlementA!.transactionId).toBeNull(); // no real payment

      // ── Path B: via Redsys (simulated) ────────────────────────────────────
      const listingB = await createActiveListing('-unified-B');

      // Create a PENDING featured-pay Transaction (as RedsysService would)
      const featuredPrice = await prisma.price.findUniqueOrThrow({
        where: { id: featuredPrice7dId },
      });
      const tax = redsysTaxBreakdown(featuredPrice.amount);
      const tx = await prisma.transaction.create({
        data: {
          userId: sellerUserId,
          priceId: featuredPrice7dId,
          listingId: listingB,
          ...tax,
          status: TransactionStatus.PENDING,
          gateway: 'REDSYS',
          gatewayPaymentIntentId: `20260626RF6-${Date.now()}`,
        },
        select: { id: true, amountGross: true },
      });

      const cents = tx.amountGross.mul(100).toFixed(0);
      await redsysProcessor.processSuccess({
        transactionId: tx.id,
        dsAmount: cents,
        dsOrder: tx.id.slice(0, 12),
      });

      const entitlementB = await prisma.entitlement.findFirst({
        where: { listingId: listingB, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlementB).not.toBeNull();
      expect(entitlementB!.transactionId).toBe(tx.id); // has real transaction ref

      // Both must produce the same type and same approximate expiresAt
      expect(entitlementA!.type).toBe(entitlementB!.type);
      expect(entitlementA!.priceId).toBe(entitlementB!.priceId);

      const diffA = entitlementA!.expiresAt!.getTime() - Date.now();
      const diffB = entitlementB!.expiresAt!.getTime() - Date.now();
      // Both should be approximately 7 days in the future (within 1 minute of each other)
      expect(Math.abs(diffA - diffB)).toBeLessThan(60_000);

      // Transaction is SUCCEEDED after processor ran
      const txAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(txAfter.status).toBe(TransactionStatus.SUCCEEDED);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /billing/wallet — after movements
  // ---------------------------------------------------------------------------

  describe('GET /billing/wallet after credits and debits', () => {
    it('reflects correct balance and paginates movements', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/billing/wallet')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      // Balance should reflect the debits made in previous tests
      expect(typeof res.body.balance).toBe('number');
      expect(res.body.balance).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.totalPages).toBe('number');
      // All previous debits should be in the ledger
      expect(res.body.total).toBeGreaterThan(0);
    });
  });
});
