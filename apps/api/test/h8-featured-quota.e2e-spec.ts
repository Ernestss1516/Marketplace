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
 *
 * H8.5a — bifurcación con vía elegida por el usuario (describe('H8.5a — ...') más abajo):
 * ya NO es "cuota automática primero" (eso era H8.3, superado por esta ráfaga). El usuario
 * elige useQuota:true (gratis, duración fija de proQuotaFeaturedDurationDays, falla explícito
 * si no hay cuota) o useQuota:false/omitido (créditos, duración a elegir vía priceId, cuota
 * intacta aunque tenga). Incluye los dos tests de concurrencia (best-effort + determinista)
 * heredados de H8.3, adaptados a la elección explícita.
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
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { EntitlementService } from 'src/modules/billing/entitlement.service';
import { BillingService } from 'src/modules/billing/billing.service';
import { QUEUE_INDEXING } from 'src/infra/queue/queue.constants';

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
      quotaDurationDays?: number;
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
    expect(status.quotaDurationDays).toBe(7); // H8.5b: default proQuotaFeaturedDurationDays
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

  it('CARACTERIZACIÓN — alta día 1 vs alta día 15 del mismo mes calendario: ambas ven la cuota COMPLETA, sin prorrateo (Monetización ráfaga 1)', async () => {
    // getFeaturedQuotaStatus deriva el periodo de Subscription.currentPeriodStart, que es
    // el instante de ALTA (billing.processor.ts fija currentPeriodStart = now() al crear
    // la suscripción), no el día del mes calendario. Este test blinda ese comportamiento
    // documentado (diseno-facturacion.md §15, "Reseteo de la cuota DERIVADO"): un alta a
    // mitad de mes no reduce la cuota — el "periodo" de un Pro siempre dura 30 días
    // completos desde SU alta, no desde el día 1 del calendario. Si alguien introdujera
    // prorrateo por accidente (p. ej. calculando remaining en función del día del mes),
    // este test lo detectaría.
    const day1 = new Date();
    day1.setDate(1);
    day1.setHours(10, 0, 0, 0);
    const day15 = new Date();
    day15.setDate(15);
    day15.setHours(10, 0, 0, 0);

    const { user: userDay1, token: tokenDay1 } = await createUser('signup-day1');
    await createProSubscription(
      userDay1.id,
      day1,
      new Date(day1.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    const { user: userDay15, token: tokenDay15 } = await createUser('signup-day15');
    await createProSubscription(
      userDay15.id,
      day15,
      new Date(day15.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    const statusDay1 = await getProStatus(tokenDay1);
    const statusDay15 = await getProStatus(tokenDay15);

    // Misma cuota completa (4) para ambos — el día del mes en que se dio de alta no influye.
    expect(statusDay1.limit).toBe(4);
    expect(statusDay1.remaining).toBe(4);
    expect(statusDay15.limit).toBe(4);
    expect(statusDay15.remaining).toBe(4);
    expect(statusDay1.remaining).toBe(statusDay15.remaining);
  });

  // ---------------------------------------------------------------------------
  // H8.5a — POST /billing/featured-by-credits: vía ELEGIDA por el usuario
  // ---------------------------------------------------------------------------

  describe('H8.5a — POST /billing/featured-by-credits: useQuota elegido por el usuario', () => {
    const QUOTA_DURATION_DAYS = 7; // matches the default seeded in proQuotaFeaturedDurationDays

    beforeAll(async () => {
      await prisma.setting.upsert({
        where: { key: 'proQuotaFeaturedDurationDays' },
        create: { key: 'proQuotaFeaturedDurationDays', value: QUOTA_DURATION_DAYS },
        update: { value: QUOTA_DURATION_DAYS },
      });
    });

    async function getFeaturedPriceIdByDuration(days: number): Promise<string> {
      const price = await prisma.price.findFirst({ where: { durationDays: days, creditPackId: null } });
      if (!price) throw new Error(`Featured listing price ${days}d not found — run seed-test.ts`);
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

    function destacar(
      token: string,
      listingId: string,
      opts: { useQuota?: boolean; priceId?: string } = {},
    ) {
      return request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId, ...opts });
    }

    /** Consume `count` quota slots for userId with grants inside the current period. */
    async function consumeQuota(userId: string, suffix: string, count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        const l = await createActiveListing(userId, `${suffix}-${i}`);
        await createProQuotaGrant(userId, l.id, new Date(Date.now() - 1000));
      }
    }

    it('elige CUOTA con cuota disponible → gratis, duración fija, origin=PRO_QUOTA, wallet intacto, remaining baja en 1', async () => {
      const { user, token } = await createUser('quota-happy');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 0); // no credits at all — the quota path must not need them

      const listing = await createActiveListing(user.id, 'quota-happy');

      expect((await getProStatus(token)).remaining).toBe(4);

      const res = await destacar(token, listing.id, { useQuota: true }).expect(201);
      expect(res.body.viaQuota).toBe(true);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.origin).toBe(FeaturedOrigin.PRO_QUOTA);
      expect(entitlement!.transactionId).toBeNull();
      expect(entitlement!.priceId).toBeNull(); // no variant chosen — fixed duration, no Price

      const diffDays = (entitlement!.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(QUOTA_DURATION_DAYS, 0);

      // No wallet movement whatsoever — free grant.
      expect(await getWalletBalance(user.id)).toBe(0);
      const ledger = await prisma.creditLedger.findFirst({ where: { referenceId: listing.id } });
      expect(ledger).toBeNull();

      const statusAfter = await getProStatus(token);
      expect(statusAfter.used).toBe(1);
      expect(statusAfter.remaining).toBe(3);
    });

    it('H8 Bloque D fase 4 — cuota y créditos delegan en grantFeaturedListingTx (unificación), y ambos encolan reindexado', async () => {
      const billingService = app.get(BillingService);
      const indexingQueue = app.get<Queue>(getQueueToken(QUEUE_INDEXING));
      const grantSpy = jest.spyOn(billingService, 'grantFeaturedListingTx');

      // ── Rama cuota ──────────────────────────────────────────────────────────
      const { user, token } = await createUser('unify-quota');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      const quotaListing = await createActiveListing(user.id, 'unify-quota');

      const jobsBefore = await indexingQueue.getJobs(['waiting', 'active', 'completed', 'delayed']);

      await destacar(token, quotaListing.id, { useQuota: true }).expect(201);

      expect(grantSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: user.id,
          listingId: quotaListing.id,
          origin: FeaturedOrigin.PRO_QUOTA,
        }),
      );
      const jobsAfterQuota = await indexingQueue.getJobs(['waiting', 'active', 'completed', 'delayed']);
      expect(jobsAfterQuota.some((j) => j.data?.listingId === quotaListing.id)).toBe(true);
      expect(jobsAfterQuota.length).toBeGreaterThan(jobsBefore.length);

      // ── Rama créditos ───────────────────────────────────────────────────────
      grantSpy.mockClear();
      await grantWallet(user.id, 1000);
      const creditsListing = await createActiveListing(user.id, 'unify-credits');
      const price7dId = await getFeaturedPriceIdByDuration(7);

      await destacar(token, creditsListing.id, { priceId: price7dId }).expect(201);

      expect(grantSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: user.id,
          listingId: creditsListing.id,
          priceId: price7dId,
          origin: FeaturedOrigin.CREDITS,
        }),
      );
      const jobsAfterCredits = await indexingQueue.getJobs(['waiting', 'active', 'completed', 'delayed']);
      expect(jobsAfterCredits.some((j) => j.data?.listingId === creditsListing.id)).toBe(true);

      grantSpy.mockRestore();
    });

    it('elige CUOTA con un priceId de 30d adjunto → lo IGNORA, usa siempre proQuotaFeaturedDurationDays', async () => {
      const { user, token } = await createUser('quota-ignores-price');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      const listing = await createActiveListing(user.id, 'quota-ignores-price');
      const price30dId = await getFeaturedPriceIdByDuration(30);

      const res = await destacar(token, listing.id, { useQuota: true, priceId: price30dId }).expect(
        201,
      );
      expect(res.body.viaQuota).toBe(true);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      // Duration must reflect the fixed quota setting (7d), NOT the 30d price sent.
      const diffDays = (entitlement!.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(QUOTA_DURATION_DAYS, 0);
      expect(diffDays).not.toBeCloseTo(30, 0);
      expect(entitlement!.priceId).toBeNull();
    });

    it('elige CUOTA sin cuota disponible → error explícito, NO cae a créditos ni crea entitlement', async () => {
      const { user, token } = await createUser('quota-denied');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 1000); // plenty of credits — must NOT be touched
      await consumeQuota(user.id, 'quota-denied-prior', 4); // limit 4 → remaining 0

      const listing = await createActiveListing(user.id, 'quota-denied-target');
      const balanceBefore = await getWalletBalance(user.id);

      const res = await destacar(token, listing.id, { useQuota: true }).expect(400);
      expect(res.body.code ?? res.body.message?.code).toBe('QUOTA_UNAVAILABLE');

      // No silent fallback to credits: no entitlement, no wallet movement.
      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).toBeNull();
      expect(await getWalletBalance(user.id)).toBe(balanceBefore);
    });

    it('elige CRÉDITOS teniendo cuota disponible → se cobran créditos, origin=CREDITS, cuota INTACTA', async () => {
      const { user, token } = await createUser('credits-with-quota');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await grantWallet(user.id, 100);

      const remainingBefore = (await getProStatus(token)).remaining;
      expect(remainingBefore).toBe(4);

      const listing = await createActiveListing(user.id, 'credits-with-quota');
      const priceId = await getFeaturedPriceIdByDuration(14);
      const costSetting = await prisma.setting.findUnique({ where: { key: 'featuredCreditCost14d' } });
      const cost = Number(costSetting!.value);
      const balanceBefore = await getWalletBalance(user.id);

      const res = await destacar(token, listing.id, { useQuota: false, priceId }).expect(201);
      expect(res.body.viaQuota).toBe(false);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement!.origin).toBe(FeaturedOrigin.CREDITS);
      expect(entitlement!.priceId).toBe(priceId);
      expect(await getWalletBalance(user.id)).toBe(balanceBefore - cost);

      const diffDays = (entitlement!.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(14, 0); // the chosen variant, not the quota's fixed duration

      // The user deliberately paid instead of using quota — quota must be untouched.
      const statusAfter = await getProStatus(token);
      expect(statusAfter.remaining).toBe(remainingBefore);
      expect(statusAfter.used).toBe(0);
    });

    it('elige CRÉDITOS (sin cuota) — igual que siempre: éxito con saldo, 402 sin saldo', async () => {
      const { user, token } = await createUser('credits-nopro');
      await grantWallet(user.id, 100);
      const listing = await createActiveListing(user.id, 'credits-nopro');
      const priceId = await getFeaturedPriceIdByDuration(7);

      const res = await destacar(token, listing.id, { useQuota: false, priceId }).expect(201);
      expect(res.body.viaQuota).toBe(false);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement!.origin).toBe(FeaturedOrigin.CREDITS);

      // Second listing, same user, wallet now empty → 402.
      const listing2 = await createActiveListing(user.id, 'credits-nopro-2');
      await grantWallet(user.id, 0);
      await destacar(token, listing2.id, { useQuota: false, priceId }).expect(402);
    });

    it('la duración de la cuota respeta el Setting: cambia proQuotaFeaturedDurationDays → los nuevos gratis usan la nueva duración', async () => {
      const { user, token } = await createUser('quota-duration-setting');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );

      await prisma.setting.update({
        where: { key: 'proQuotaFeaturedDurationDays' },
        data: { value: 15 },
      });

      try {
        const listing = await createActiveListing(user.id, 'quota-duration-setting');
        const res = await destacar(token, listing.id, { useQuota: true }).expect(201);
        expect(res.body.viaQuota).toBe(true);

        const entitlement = await prisma.entitlement.findFirst({
          where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
        });
        const diffDays = (entitlement!.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeCloseTo(15, 0);
      } finally {
        // Restore for subsequent tests in this describe block.
        await prisma.setting.update({
          where: { key: 'proQuotaFeaturedDurationDays' },
          data: { value: QUOTA_DURATION_DAYS },
        });
      }
    });

    it('CONCURRENCIA (best-effort, timing real) — dos CUOTA simultáneas con remaining=1: solo UNA consume cuota', async () => {
      const { user, token } = await createUser('quota-race');
      await createProSubscription(
        user.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      );
      await consumeQuota(user.id, 'quota-race-prior', 3); // limit 4 → remaining = 1

      expect((await getProStatus(token)).remaining).toBe(1);

      const listingA = await createActiveListing(user.id, 'quota-race-A');
      const listingB = await createActiveListing(user.id, 'quota-race-B');

      // Fire both "destacar por cuota" requests concurrently — this is the race:
      // without the Subscription row lock (EntitlementService.hasAvailableFeaturedQuota),
      // both could read remaining=1 before either creates its PRO_QUOTA entitlement,
      // and BOTH would grant a free destacado for a quota of one.
      const [resA, resB] = await Promise.all([
        destacar(token, listingA.id, { useQuota: true }),
        destacar(token, listingB.id, { useQuota: true }),
      ]);

      const statuses = [resA.status, resB.status];
      // Exactly one succeeds via quota (201); the other must be explicitly rejected
      // (400 QUOTA_UNAVAILABLE) — never both succeed (that would be two free grants
      // for a quota of one), never both fail.
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 400)).toHaveLength(1);

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
      await consumeQuota(user.id, 'quota-race-det-prior', 3); // limit 4 → remaining = 1

      const listingA = await createActiveListing(user.id, 'quota-race-det-A');
      const listingB = await createActiveListing(user.id, 'quota-race-det-B');

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
          destacar(token, listingA.id, { useQuota: true }),
          destacar(token, listingB.id, { useQuota: true }),
        ]);
        const elapsed = Date.now() - start;

        // If the second request had genuinely blocked on the Postgres lock (rather
        // than racing past a missing one), the whole Promise.all must have taken at
        // least ~DELAY_MS — proof the blocking really happened, not just that the
        // final counts happen to look right.
        expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS - 20);

        const statuses = [resA.status, resB.status];
        expect(statuses.filter((s) => s === 201)).toHaveLength(1);
        expect(statuses.filter((s) => s === 400)).toHaveLength(1);

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
