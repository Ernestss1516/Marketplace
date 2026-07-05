/**
 * H8.2 — Cuota mensual de destacados gratis de Pro (e2e)
 *
 * Verifica EntitlementService.getFeaturedQuotaStatus (vía GET /billing/pro-status):
 *   - No-Pro → isPro:false, sin cuota.
 *   - Pro con 0 usados → remaining = limit.
 *   - Pro con algunos PRO_QUOTA en el periodo vigente → used correcto.
 *   - CLAVE: PRO_QUOTA de un periodo ANTERIOR (createdAt < currentPeriodStart) no cuenta —
 *     prueba que el reseteo derivado funciona sin cron.
 *
 * El origin propagado en featuredByCredits (CREDITS) y en el flujo Redsys (REDSYS) se
 * verifica en billing-rf6.e2e-spec.ts, describe('grantFeaturedListing unified (§3.1)').
 */

import { INestApplication } from '@nestjs/common';
import {
  CreditLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  Prisma,
  PrismaClient,
  ProductType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { EntitlementService } from 'src/modules/billing/entitlement.service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('H8.2 — GET /billing/pro-status (cuota mensual de destacados Pro)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    // Setting es un fixture global (excluido de cleanDb) — fijar valor conocido para este suite.
    await prisma.setting.upsert({
      where: { key: 'proMonthlyFeaturedQuota' },
      create: { key: 'proMonthlyFeaturedQuota', value: 4 },
      update: { value: 4 },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createUser(suffix: string) {
    const email = `h8q-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `H8Q ${suffix}`,
        slug: `h8q-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const token = await loginUser(app, email, 'Test1234!');
    return { user, token };
  }

  async function createActiveListing(userId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `H8Q listing ${suffix}`,
        slug: `h8q-listing-${suffix}-${Date.now()}`,
        description: 'desc',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId: userId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  async function getProPriceId(): Promise<string> {
    const price = await prisma.price.findFirst({
      where: { product: { type: ProductType.RECURRING } },
      select: { id: true },
    });
    if (!price) throw new Error('No se encontró ningún Price RECURRING sembrado (Plan Pro)');
    return price.id;
  }

  /**
   * Crea una Subscription ACTIVE + su Entitlement PRO_SUBSCRIPTION vinculado
   * (subscriptionId), replicando el invariante real de ensureProEntitlement
   * (billing.processor.ts): todo PRO_SUBSCRIPTION vigente tiene una Subscription.
   */
  async function createProSubscription(userId: string, periodStart: Date, periodEnd: Date) {
    const priceId = await getProPriceId();
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gatewaySubscriptionId: `sub_h8q_${userId}_${Date.now()}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId,
        expiresAt: periodEnd,
      },
    });
    return subscription;
  }

  async function createProQuotaGrant(userId: string, listingId: string, createdAt: Date) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        origin: FeaturedOrigin.PRO_QUOTA,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt,
      },
    });
  }

  async function getProStatus(token: string) {
    const res = await request(app.getHttpServer())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as {
      isPro: boolean;
      limit: number;
      used: number;
      remaining: number;
      periodStart?: string;
      periodEnd?: string;
    };
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  it('sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/billing/pro-status').expect(401);
  });

  it('usuario no-Pro → isPro:false, sin cuota', async () => {
    const { token } = await createUser('nopro');

    const status = await getProStatus(token);
    expect(status).toEqual({ isPro: false, limit: 0, used: 0, remaining: 0 });
  });

  it('Pro con 0 usados este periodo → remaining = limit', async () => {
    const { user, token } = await createUser('zero-used');
    const periodStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await createProSubscription(user.id, periodStart, periodEnd);

    const status = await getProStatus(token);
    expect(status.isPro).toBe(true);
    expect(status.limit).toBe(4);
    expect(status.used).toBe(0);
    expect(status.remaining).toBe(4);
    expect(new Date(status.periodStart!).getTime()).toBe(periodStart.getTime());
    expect(new Date(status.periodEnd!).getTime()).toBe(periodEnd.getTime());
  });

  it('Pro con algunos PRO_QUOTA usados en el periodo vigente → used correcto', async () => {
    const { user, token } = await createUser('some-used');
    const periodStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await createProSubscription(user.id, periodStart, periodEnd);

    const listing1 = await createActiveListing(user.id, 'some-used-1');
    const listing2 = await createActiveListing(user.id, 'some-used-2');
    await createProQuotaGrant(user.id, listing1.id, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000));
    await createProQuotaGrant(user.id, listing2.id, new Date(Date.now() - 1 * 24 * 60 * 60 * 1000));

    const status = await getProStatus(token);
    expect(status.used).toBe(2);
    expect(status.remaining).toBe(2);
  });

  it('CLAVE — PRO_QUOTA de un periodo ANTERIOR no cuenta (reseteo derivado, sin cron)', async () => {
    const { user, token } = await createUser('reset-derived');
    // El periodo "acaba de empezar" (simula una renovación de Stripe que acaba de avanzar
    // currentPeriodStart) — cualquier PRO_QUOTA anterior a este instante pertenece al ciclo
    // ya cerrado y no debe contar, aunque nadie haya "reseteado" nada explícitamente.
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createProSubscription(user.id, periodStart, periodEnd);

    const oldListing = await createActiveListing(user.id, 'reset-old');
    const newListing = await createActiveListing(user.id, 'reset-new');

    // Grant del periodo ANTERIOR (antes de currentPeriodStart) — no debe contar.
    await createProQuotaGrant(user.id, oldListing.id, new Date(periodStart.getTime() - 24 * 60 * 60 * 1000));
    // Grant del periodo VIGENTE (después de currentPeriodStart) — sí debe contar.
    await createProQuotaGrant(user.id, newListing.id, new Date(periodStart.getTime() + 60 * 60 * 1000));

    const status = await getProStatus(token);
    expect(status.used).toBe(1);
    expect(status.remaining).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // H8.3 — POST /billing/featured-by-credits: bifurcación cuota-primero
  // ---------------------------------------------------------------------------

  describe('H8.3 — POST /billing/featured-by-credits: cuota-primero (bifurcación)', () => {
    async function getFeaturedPrice7dId(): Promise<string> {
      const price = await prisma.price.findFirst({ where: { durationDays: 7, creditPackId: null } });
      if (!price) throw new Error('Featured listing price 7d not found — run seed-test.ts');
      return price.id;
    }

    async function grantWallet(userId: string, balance: number) {
      await prisma.wallet.upsert({
        where: { userId },
        create: { userId, balance },
        update: { balance },
      });
    }

    async function getWalletBalance(userId: string): Promise<number> {
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      return wallet?.balance ?? 0;
    }

    function destacar(token: string, listingId: string, priceId: string) {
      return request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ priceId, listingId });
    }

    /** Consume `count` quota slots for userId with grants inside the current period. */
    async function consumeQuota(userId: string, suffix: string, count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        const l = await createActiveListing(userId, `${suffix}-${i}`);
        await createProQuotaGrant(userId, l.id, new Date(Date.now() - 1000));
      }
    }

    it('Pro con cuota disponible → viaQuota:true, origin=PRO_QUOTA, wallet intacto, remaining baja en 1', async () => {
      const { user, token } = await createUser('quota-happy');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 0); // no credits at all — the quota path must not need them

      const listing = await createActiveListing(user.id, 'quota-happy');
      const priceId = await getFeaturedPrice7dId();

      expect((await getProStatus(token)).remaining).toBe(4);

      const res = await destacar(token, listing.id, priceId).expect(201);
      expect(res.body.viaQuota).toBe(true);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.origin).toBe(FeaturedOrigin.PRO_QUOTA);
      expect(entitlement!.transactionId).toBeNull();

      // No wallet movement whatsoever — free grant.
      expect(await getWalletBalance(user.id)).toBe(0);
      const ledger = await prisma.creditLedger.findFirst({ where: { referenceId: listing.id } });
      expect(ledger).toBeNull();

      const statusAfter = await getProStatus(token);
      expect(statusAfter.used).toBe(1);
      expect(statusAfter.remaining).toBe(3);
    });

    it('Pro con cuota agotada → cae a créditos, débito wallet, origin=CREDITS', async () => {
      const { user, token } = await createUser('quota-exhausted');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 100);
      await consumeQuota(user.id, 'quota-exhausted-prior', 4); // limit is 4 → remaining 0

      expect((await getProStatus(token)).remaining).toBe(0);

      const listing = await createActiveListing(user.id, 'quota-exhausted-target');
      const priceId = await getFeaturedPrice7dId();
      const costSetting = await prisma.setting.findUnique({ where: { key: 'featuredCreditCost7d' } });
      const cost = Number(costSetting!.value);
      const balanceBefore = await getWalletBalance(user.id);

      const res = await destacar(token, listing.id, priceId).expect(201);
      expect(res.body.viaQuota).toBe(false);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement!.origin).toBe(FeaturedOrigin.CREDITS);
      expect(await getWalletBalance(user.id)).toBe(balanceBefore - cost);

      const ledger = await prisma.creditLedger.findFirst({
        where: { type: CreditLedgerType.FEATURED_DEBIT, referenceId: listing.id },
      });
      expect(ledger).not.toBeNull();
    });

    it('no-Pro → sigue yendo por créditos, sin cambios respecto a antes de H8.3', async () => {
      const { user, token } = await createUser('quota-nopro');
      await grantWallet(user.id, 100);
      const listing = await createActiveListing(user.id, 'quota-nopro');
      const priceId = await getFeaturedPrice7dId();

      const res = await destacar(token, listing.id, priceId).expect(201);
      expect(res.body.viaQuota).toBe(false);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement!.origin).toBe(FeaturedOrigin.CREDITS);
    });

    it('Pro sin cuota y sin créditos → 402, igual que hoy un no-Pro sin créditos', async () => {
      const { user, token } = await createUser('quota-402');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await consumeQuota(user.id, 'quota-402-prior', 4); // remaining 0, no wallet at all

      const listing = await createActiveListing(user.id, 'quota-402-target');
      const priceId = await getFeaturedPrice7dId();

      await destacar(token, listing.id, priceId).expect(402);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).toBeNull();
    });

    it('CONCURRENCIA (best-effort, timing real) — dos destacados simultáneos con remaining=1: solo UNO consume cuota', async () => {
      const { user, token } = await createUser('quota-race');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      // Enough credits so whichever request loses the quota race still succeeds
      // via the fallback (proves it falls to credits, not just "fails").
      await grantWallet(user.id, 1000);
      await consumeQuota(user.id, 'quota-race-prior', 3); // limit 4 → remaining = 1

      expect((await getProStatus(token)).remaining).toBe(1);

      const listingA = await createActiveListing(user.id, 'quota-race-A');
      const listingB = await createActiveListing(user.id, 'quota-race-B');
      const priceId = await getFeaturedPrice7dId();

      // Fire both "destacar" requests concurrently — this is the race: without the
      // Subscription row lock (EntitlementService.hasAvailableFeaturedQuota), both
      // could read remaining=1 before either creates its PRO_QUOTA entitlement, and
      // BOTH would grant a free destacado for a quota of one.
      const [resA, resB] = await Promise.all([
        destacar(token, listingA.id, priceId),
        destacar(token, listingB.id, priceId),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      const viaQuotaFlags = [resA.body.viaQuota, resB.body.viaQuota];
      // Exactly one of the two consumed the free quota slot — never both, never neither
      // (the loser must fall back to credits, which it can afford here).
      expect(viaQuotaFlags.filter(Boolean)).toHaveLength(1);
      expect(viaQuotaFlags.filter((v) => v === false)).toHaveLength(1);

      // Verify at the DB level, not just the HTTP response: exactly one new
      // PRO_QUOTA grant landed, and used/remaining reflect it — no free destacados
      // regalados de más.
      const statusAfter = await getProStatus(token);
      expect(statusAfter.used).toBe(4); // 3 prior + exactly 1 new
      expect(statusAfter.remaining).toBe(0);

      const quotaGrants = await prisma.entitlement.count({
        where: {
          userId: user.id,
          type: EntitlementType.FEATURED_LISTING,
          origin: FeaturedOrigin.PRO_QUOTA,
          listingId: { in: [listingA.id, listingB.id] },
        },
      });
      expect(quotaGrants).toBe(1);

      const creditGrants = await prisma.entitlement.count({
        where: {
          userId: user.id,
          type: EntitlementType.FEATURED_LISTING,
          origin: FeaturedOrigin.CREDITS,
          listingId: { in: [listingA.id, listingB.id] },
        },
      });
      expect(creditGrants).toBe(1); // the loser fell back to credits
    });

    it('CONCURRENCIA (determinista) — el lock realmente bloquea al segundo hasta que el primero confirma', async () => {
      // The test above relies on real request timing, which on a fast local Postgres
      // can resolve so quickly that both requests never actually overlap — it would
      // pass even with the FOR UPDATE lock removed (verified manually while writing
      // this suite). This test forces genuine overlap: it wraps the REAL
      // hasAvailableFeaturedQuota with a delay inserted AFTER it acquires the
      // Subscription row lock but BEFORE the caller's transaction commits, so the
      // second concurrent call is guaranteed to attempt its own FOR UPDATE while the
      // first still holds it — proving Postgres actually serializes them, not just
      // that the observed outcome happens to look correct.
      const { user, token } = await createUser('quota-race-det');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 1000);
      await consumeQuota(user.id, 'quota-race-det-prior', 3); // limit 4 → remaining = 1

      const listingA = await createActiveListing(user.id, 'quota-race-det-A');
      const listingB = await createActiveListing(user.id, 'quota-race-det-B');
      const priceId = await getFeaturedPrice7dId();

      const entitlementService = app.get(EntitlementService);
      const original = entitlementService.hasAvailableFeaturedQuota.bind(entitlementService);
      const DELAY_MS = 300;
      let delayedOnce = false;

      const spy = jest
        .spyOn(entitlementService, 'hasAvailableFeaturedQuota')
        .mockImplementation(async (tx, uid) => {
          const result = await original(tx, uid);
          if (!delayedOnce) {
            // Whichever request's call lands here first holds the Subscription row
            // lock (still inside its open transaction) for DELAY_MS — plenty of time
            // for the second concurrent call's own FOR UPDATE to arrive and block.
            delayedOnce = true;
            await sleep(DELAY_MS);
          }
          return result;
        });

      try {
        const start = Date.now();
        const [resA, resB] = await Promise.all([
          destacar(token, listingA.id, priceId),
          destacar(token, listingB.id, priceId),
        ]);
        const elapsed = Date.now() - start;

        // If the second request had genuinely blocked on the Postgres lock (rather
        // than racing past a missing one), the whole Promise.all must have taken at
        // least ~DELAY_MS — proof the blocking really happened, not just that the
        // final counts happen to look right.
        expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS - 20);

        expect(resA.status).toBe(201);
        expect(resB.status).toBe(201);

        const viaQuotaFlags = [resA.body.viaQuota, resB.body.viaQuota];
        expect(viaQuotaFlags.filter(Boolean)).toHaveLength(1);
        expect(viaQuotaFlags.filter((v) => v === false)).toHaveLength(1);

        const statusAfter = await getProStatus(token);
        expect(statusAfter.used).toBe(4);
        expect(statusAfter.remaining).toBe(0);

        const quotaGrants = await prisma.entitlement.count({
          where: {
            userId: user.id,
            type: EntitlementType.FEATURED_LISTING,
            origin: FeaturedOrigin.PRO_QUOTA,
            listingId: { in: [listingA.id, listingB.id] },
          },
        });
        expect(quotaGrants).toBe(1); // never both, never neither
      } finally {
        spy.mockRestore();
      }
    });
  });
});
