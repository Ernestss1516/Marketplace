/**
 * H8 Bloque D fase 3a — Canje de cupones (e2e)
 *
 * Cubre el canje atómico (POST /coupons/redeem) y, sobre todo, las DOS
 * protecciones de concurrencia — con el mismo rigor que la cuota Pro (H8.3):
 *   - Límite total (Coupon.redemptionCount): incremento atómico condicional.
 *   - Un uso por usuario (CouponRedemption.@@unique): red de seguridad de BD.
 *
 * Los cupones se crean directamente vía Prisma en este archivo — el CRUD admin
 * es la fase 3b, no esta ráfaga.
 */

import { INestApplication } from '@nestjs/common';
import {
  CouponRewardType,
  CreditLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('H8 Bloque D fase 3a — Coupons redeem (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  async function createUser(suffix: string) {
    const email = `h8d3a-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `H8D3A ${suffix}`,
        slug: `h8d3a-${suffix}`,
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
      },
    });
    const token = await loginUser(app, email, 'Test1234!');
    return { user, token };
  }

  async function createActiveListing(userId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `H8D3A listing ${suffix}`,
        slug: `h8d3a-listing-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'desc',
        price: new Prisma.Decimal('100.00'),
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

  function activeWindow() {
    return {
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  async function createCreditsCoupon(overrides: Partial<Prisma.CouponCreateInput> = {}) {
    return prisma.coupon.create({
      data: {
        code: `CREDITS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
        rewardType: CouponRewardType.CREDITS,
        creditAmount: 50,
        active: true,
        ...activeWindow(),
        ...overrides,
      },
    });
  }

  async function createFeaturedCoupon(overrides: Partial<Prisma.CouponCreateInput> = {}) {
    return prisma.coupon.create({
      data: {
        code: `FEATURED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
        rewardType: CouponRewardType.FEATURED,
        featuredDurationDays: 7,
        active: true,
        ...activeWindow(),
        ...overrides,
      },
    });
  }

  async function getBalance(userId: string): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    return wallet?.balance ?? 0;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Canje CREDITS ───────────────────────────────────────────────────────────

  describe('Canje CREDITS', () => {
    it('cupón válido → wallet += creditAmount, CreditLedger COUPON_REDEEM, CouponRedemption creado', async () => {
      const { user, token } = await createUser('credits-ok');
      const coupon = await createCreditsCoupon({ creditAmount: 75 });
      const balanceBefore = await getBalance(user.id);

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(200);

      expect(res.body.rewardType).toBe('CREDITS');
      expect(res.body.creditAmount).toBe(75);

      const balanceAfter = await getBalance(user.id);
      expect(balanceAfter - balanceBefore).toBe(75);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const ledger = await prisma.creditLedger.findFirst({
        where: { walletId: wallet.id, type: CreditLedgerType.COUPON_REDEEM },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.amount).toBe(75);
      expect(ledger!.referenceType).toBe('Coupon');
      expect(ledger!.referenceId).toBe(coupon.id);

      const redemption = await prisma.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId: user.id } },
      });
      expect(redemption).not.toBeNull();
      expect(redemption!.referenceType).toBe('CreditLedger');
      expect(redemption!.referenceId).toBe(ledger!.id);
    });

    it('normaliza el código a mayúsculas al canjear', async () => {
      const { user, token } = await createUser('credits-normalize');
      const coupon = await createCreditsCoupon();

      await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code.toLowerCase() })
        .expect(200);

      const redemption = await prisma.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId: user.id } },
      });
      expect(redemption).not.toBeNull();
    });
  });

  // ── Canje FEATURED ──────────────────────────────────────────────────────────

  describe('Canje FEATURED', () => {
    it('cupón válido + anuncio activo propio → entitlement FEATURED_LISTING origin=COUPON', async () => {
      const { user, token } = await createUser('featured-ok');
      const listing = await createActiveListing(user.id, 'feat-ok');
      const coupon = await createFeaturedCoupon({ featuredDurationDays: 14 });

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code, listingId: listing.id })
        .expect(200);

      expect(res.body.rewardType).toBe('FEATURED');
      expect(res.body.featuredDurationDays).toBe(14);

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.origin).toBe(FeaturedOrigin.COUPON);
      expect(entitlement!.priceId).toBeNull();

      const redemption = await prisma.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId: user.id } },
      });
      expect(redemption).not.toBeNull();
      expect(redemption!.referenceType).toBe('Entitlement');
      expect(redemption!.referenceId).toBe(entitlement!.id);
    });

    it('sin listingId → 400 LISTING_REQUIRED', async () => {
      const { token } = await createUser('featured-nolisting');
      const coupon = await createFeaturedCoupon();

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(400);

      expect(res.body.message?.code ?? res.body.code).toBe('LISTING_REQUIRED');
    });

    it('ROLLBACK — anuncio ya destacado → error, redemptionCount intacto, sin CouponRedemption', async () => {
      const { user, token } = await createUser('featured-rollback');
      const listing = await createActiveListing(user.id, 'feat-rollback');
      const coupon = await createFeaturedCoupon();

      // Destacar el anuncio de antemano (vía entitlement directo).
      await prisma.entitlement.create({
        data: {
          userId: user.id,
          type: EntitlementType.FEATURED_LISTING,
          listingId: listing.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const countBefore = (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
        .redemptionCount;

      await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code, listingId: listing.id })
        .expect(400);

      const countAfter = (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
        .redemptionCount;
      expect(countAfter).toBe(countBefore); // el incremento de (a) se deshizo con el rollback

      const redemption = await prisma.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId: user.id } },
      });
      expect(redemption).toBeNull(); // el cupón no se consumió
    });
  });

  // ── Errores ──────────────────────────────────────────────────────────────────

  describe('Errores', () => {
    it('código inexistente → 404 COUPON_NOT_FOUND', async () => {
      const { token } = await createUser('err-notfound');
      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'NO-EXISTE-ZZZ' })
        .expect(404);
      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_NOT_FOUND');
    });

    it('cupón inactivo (active:false) → 400 COUPON_INACTIVE', async () => {
      const { token } = await createUser('err-inactive');
      const coupon = await createCreditsCoupon({ active: false });
      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(400);
      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_INACTIVE');
    });

    it('cupón fuera de fechas (ya caducado) → 400 COUPON_INACTIVE', async () => {
      const { token } = await createUser('err-expired');
      const coupon = await createCreditsCoupon({
        startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(400);
      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_INACTIVE');
    });

    it('agotado (maxRedemptions alcanzado) → 409 COUPON_EXHAUSTED, sin efectos secundarios', async () => {
      const { token } = await createUser('err-exhausted');
      const coupon = await createCreditsCoupon({ maxRedemptions: 1, redemptionCount: 1 });

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(409);
      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_EXHAUSTED');

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.redemptionCount).toBe(1); // no subió a 2
    });

    it('ya canjeado por este usuario → 409 COUPON_ALREADY_REDEEMED, sin duplicar la recompensa', async () => {
      const { user, token } = await createUser('err-already');
      const coupon = await createCreditsCoupon({ creditAmount: 20 });

      await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(200);

      const balanceAfterFirst = await getBalance(user.id);

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(409);
      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_ALREADY_REDEEMED');

      const balanceAfterSecond = await getBalance(user.id);
      expect(balanceAfterSecond).toBe(balanceAfterFirst); // no se acreditó dos veces
    });
  });

  // ── CONCURRENCIA (obligatorio, rigor H8.3) ─────────────────────────────────

  describe('Concurrencia', () => {
    it('LÍMITE TOTAL: dos usuarios distintos canjean el último uso disponible a la vez → exactamente uno pasa', async () => {
      const { user: userA, token: tokenA } = await createUser('conc-limit-a');
      const { user: userB, token: tokenB } = await createUser('conc-limit-b');
      // maxRedemptions=5, ya van 4 → queda exactamente 1 uso disponible.
      const coupon = await createCreditsCoupon({ maxRedemptions: 5, redemptionCount: 4, creditAmount: 10 });

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/coupons/redeem')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ code: coupon.code }),
        request(app.getHttpServer())
          .post('/api/coupons/redeem')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ code: coupon.code }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      // Exactamente uno 200 y el otro 409 — nunca los dos 200 (eso sería el bug:
      // sin el UPDATE condicional, ambos leerían redemptionCount=4 < 5 y pasarían).
      expect(statuses).toEqual([200, 409]);

      const winner = resA.status === 200 ? resA : resB;
      const loser = resA.status === 200 ? resB : resA;
      expect(winner.body.rewardType).toBe('CREDITS');
      expect(loser.body.message?.code ?? loser.body.code).toBe('COUPON_EXHAUSTED');

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.redemptionCount).toBe(5); // nunca 6

      // Solo el ganador tiene CouponRedemption
      const redemptionsCount = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      expect(redemptionsCount).toBe(1);

      // Solo un usuario recibió los créditos
      const balanceA = await getBalance(userA.id);
      const balanceB = await getBalance(userB.id);
      expect([balanceA, balanceB].sort()).toEqual([0, 10]);
    });

    it('UN USO POR USUARIO: el mismo usuario canjea dos veces a la vez → exactamente una pasa', async () => {
      const { user, token } = await createUser('conc-oneperuser');
      // Sin límite total, para aislar específicamente la protección de un-uso-por-usuario.
      const coupon = await createCreditsCoupon({ maxRedemptions: null, creditAmount: 30 });

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/coupons/redeem')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: coupon.code }),
        request(app.getHttpServer())
          .post('/api/coupons/redeem')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: coupon.code }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // El usuario recibió los créditos UNA sola vez, no dos.
      const balance = await getBalance(user.id);
      expect(balance).toBe(30);

      const redemptionsCount = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId: user.id },
      });
      expect(redemptionsCount).toBe(1);
    });
  });
});
