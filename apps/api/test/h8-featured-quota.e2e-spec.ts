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
});
