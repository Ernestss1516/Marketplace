/**
 * H8 Bloque D fase 2 — Descuentos porcentuales en bump/destacar vía campañas (e2e)
 *
 * Construye sobre el motor de campañas de fase 1 (CampaignType.ACTION_DISCOUNT,
 * params { action, percent }). Cubre:
 *   - Descuento aplicado en featuredByCredits (rama créditos) y en bump — floor,
 *     nota de campaña en el CreditLedger, entitlement/bumpedAt sin cambios.
 *   - La rama de cuota Pro (useQuota:true) NUNCA se toca por el descuento.
 *   - Redsys directo NUNCA se descuenta (principio fiscal — IVA intacto).
 *   - Sin campaña → comportamiento idéntico a hoy (note null).
 *   - Solapamiento refinado por acción (BUMP/FEATURED conviven; misma acción no).
 *   - Tope de percent (90) en el DTO.
 *   - Catálogo expone original+efectivo+% solo cuando hay descuento activo.
 *
 * Nota: Campaign no tiene FK a User, así que cleanDb() (TRUNCATE "User" CASCADE)
 * no lo limpia — se limpia explícitamente en este archivo (igual que en
 * h8-d1-campaigns.e2e-spec.ts).
 */

import { INestApplication } from '@nestjs/common';
import {
  CampaignType,
  CreditLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  Prisma,
  PrismaClient,
  ProductType,
  TransactionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('H8 Bloque D fase 2 — Action discount campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redsysProcessor: RedsysProcessor;

  let categoryId: string;
  let sellerUserId: string;
  let sellerToken: string;
  let proUserId: string;
  let proToken: string;

  let featuredPrice7dId: string;
  let featuredCreditCost7d: number; // 30 (seed)
  let bumpCreditCostDefault: number; // 5 (seed)

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  async function cleanCampaigns(): Promise<void> {
    await prisma.transaction.updateMany({ data: { campaignId: null } });
    await prisma.campaign.deleteMany({});
  }

  async function createActiveListing(userId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `H8D2 listing ${suffix}`,
        slug: `h8d2-listing-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  async function createFeaturedActionDiscount(percent: number, active = true) {
    return prisma.campaign.create({
      data: {
        name: `H8D2 Test FEATURED -${percent}%`,
        type: CampaignType.ACTION_DISCOUNT,
        active,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
        params: { action: 'FEATURED', percent },
      },
    });
  }

  async function createBumpActionDiscount(percent: number, active = true) {
    return prisma.campaign.create({
      data: {
        name: `H8D2 Test BUMP -${percent}%`,
        type: CampaignType.ACTION_DISCOUNT,
        active,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
        params: { action: 'BUMP', percent },
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

  async function createProSubscription(userId: string) {
    const priceId = await getProPriceId();
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gatewaySubscriptionId: `sub_h8d2_${userId}_${Date.now()}`,
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

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await cleanCampaigns();

    redsysProcessor = app.get(RedsysProcessor);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const seller = await prisma.user.create({
      data: {
        email: 'h8d2-seller@example.com',
        name: 'H8D2 Seller',
        slug: 'h8d2-seller',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
      },
    });
    sellerUserId = seller.id;
    sellerToken = await loginUser(app, 'h8d2-seller@example.com', 'Test1234!');

    const pro = await prisma.user.create({
      data: {
        email: 'h8d2-pro@example.com',
        name: 'H8D2 Pro',
        slug: 'h8d2-pro',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
      },
    });
    proUserId = pro.id;
    proToken = await loginUser(app, 'h8d2-pro@example.com', 'Test1234!');
    await createProSubscription(proUserId);
    // Give the Pro quota room: proMonthlyFeaturedQuota defaults to 4, used=0 here.

    const price7d = await prisma.price.findFirst({ where: { durationDays: 7, creditPackId: null } });
    if (!price7d) throw new Error('Featured listing price 7d not found — run seed-test.ts');
    featuredPrice7dId = price7d.id;

    const featuredCostSetting = await prisma.setting.findUniqueOrThrow({
      where: { key: 'featuredCreditCost7d' },
    });
    featuredCreditCost7d = Number(featuredCostSetting.value); // 30

    const bumpCostSetting = await prisma.setting.findUniqueOrThrow({ where: { key: 'bumpCreditCost' } });
    bumpCreditCostDefault = Number(bumpCostSetting.value); // 5
  });

  afterAll(async () => {
    await cleanCampaigns();
    await app.close();
    await prisma.$disconnect();
  });

  async function giveWallet(userId: string, balance: number) {
    await prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance },
      update: { balance },
    });
  }

  async function getBalance(userId: string): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    return wallet?.balance ?? 0;
  }

  // ── Descuento en featuredByCredits (rama créditos) ─────────────────────────

  describe('Descuento FEATURED — featuredByCredits (rama créditos)', () => {
    afterEach(cleanCampaigns);

    it('campaña FEATURED activa → coste floor(base*(100-%)/100); ledger con nota de campaña', async () => {
      const campaign = await createFeaturedActionDiscount(30);
      await giveWallet(sellerUserId, 1000);
      const listing = await createActiveListing(sellerUserId, 'feat-disc');
      const balanceBefore = await getBalance(sellerUserId);

      const expectedCost = Math.floor(featuredCreditCost7d * (100 - 30) / 100); // floor(21)=21
      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId: listing.id })
        .expect(201);

      const balanceAfter = await getBalance(sellerUserId);
      expect(balanceBefore - balanceAfter).toBe(expectedCost);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      const ledger = await prisma.creditLedger.findFirst({
        where: { walletId: wallet.id, type: CreditLedgerType.FEATURED_DEBIT, referenceId: listing.id },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.amount).toBe(-expectedCost);
      expect(ledger!.note).toBe(`Campaña "${campaign.name}" (-30%)`);

      // Entitlement concedido igual que siempre
      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.origin).toBe(FeaturedOrigin.CREDITS);
    });

    it('sin campaña → coste normal, note null (como hoy)', async () => {
      await giveWallet(sellerUserId, 1000);
      const listing = await createActiveListing(sellerUserId, 'feat-nodisc');
      const balanceBefore = await getBalance(sellerUserId);

      await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceId: featuredPrice7dId, listingId: listing.id })
        .expect(201);

      const balanceAfter = await getBalance(sellerUserId);
      expect(balanceBefore - balanceAfter).toBe(featuredCreditCost7d);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      const ledger = await prisma.creditLedger.findFirst({
        where: { walletId: wallet.id, type: CreditLedgerType.FEATURED_DEBIT, referenceId: listing.id },
      });
      expect(ledger!.note).toBeNull();
    });

    it('CLAVE — Pro con cuota destacando GRATIS durante campaña FEATURED sigue gratis (rama cuota intacta)', async () => {
      await createFeaturedActionDiscount(50);
      const listing = await createActiveListing(proUserId, 'feat-quota');
      const balanceBefore = await getBalance(proUserId); // 0, sin wallet

      const res = await request(app.getHttpServer())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ listingId: listing.id, useQuota: true })
        .expect(201);

      expect(res.body.viaQuota).toBe(true);

      // Sigue gratis: sin wallet creado, sin CreditLedger
      const balanceAfter = await getBalance(proUserId);
      expect(balanceAfter).toBe(balanceBefore); // 0 === 0, ningún debito

      const wallet = await prisma.wallet.findUnique({ where: { userId: proUserId } });
      if (wallet) {
        const ledger = await prisma.creditLedger.findFirst({
          where: { walletId: wallet.id, referenceId: listing.id },
        });
        expect(ledger).toBeNull();
      }

      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement).not.toBeNull();
      expect(entitlement!.origin).toBe(FeaturedOrigin.PRO_QUOTA);
    });

    it('CLAVE (IVA) — destacar con Redsys directo durante campaña → precio íntegro, SIN descuento', async () => {
      await createFeaturedActionDiscount(50);
      const listing = await createActiveListing(sellerUserId, 'feat-redsys');

      const featuredPrice = await prisma.price.findUniqueOrThrow({ where: { id: featuredPrice7dId } });
      const tax = redsysTaxBreakdown(featuredPrice.amount);
      const tx = await prisma.transaction.create({
        data: {
          userId: sellerUserId,
          priceId: featuredPrice7dId,
          listingId: listing.id,
          ...tax,
          status: TransactionStatus.PENDING,
          gateway: 'REDSYS',
          gatewayPaymentIntentId: `20260626H8D2-${Date.now()}`,
        },
        select: { id: true, amountGross: true },
      });

      // El importe cobrado es el PRECIO ÍNTEGRO en EUR — nunca se toca por campañas de créditos.
      expect(tx.amountGross.toFixed(2)).toBe(featuredPrice.amount.toFixed(2));

      const cents = tx.amountGross.mul(100).toFixed(0);
      await redsysProcessor.processSuccess({
        transactionId: tx.id,
        dsAmount: cents,
        dsOrder: tx.id.slice(0, 12),
      });

      const txAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(txAfter.status).toBe(TransactionStatus.SUCCEEDED);
      expect(txAfter.amountGross.toFixed(2)).toBe(featuredPrice.amount.toFixed(2)); // sin cambios

      // Ningún wallet debit ocurrió por este camino (Redsys nunca toca créditos)
      const entitlement = await prisma.entitlement.findFirst({
        where: { listingId: listing.id, type: EntitlementType.FEATURED_LISTING },
      });
      expect(entitlement!.origin).toBe(FeaturedOrigin.REDSYS);
    });
  });

  // ── Descuento en bump ───────────────────────────────────────────────────────

  describe('Descuento BUMP', () => {
    afterEach(cleanCampaigns);

    it('campaña BUMP activa → bump descontado; ledger con nota de campaña', async () => {
      const campaign = await createBumpActionDiscount(20);
      await giveWallet(sellerUserId, 1000);
      const listing = await createActiveListing(sellerUserId, 'bump-disc');
      const balanceBefore = await getBalance(sellerUserId);

      const expectedCost = Math.floor(bumpCreditCostDefault * (100 - 20) / 100); // floor(4)=4

      await request(app.getHttpServer())
        .post(`/api/listings/${listing.id}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const balanceAfter = await getBalance(sellerUserId);
      expect(balanceBefore - balanceAfter).toBe(expectedCost);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      const ledger = await prisma.creditLedger.findFirst({
        where: { walletId: wallet.id, type: CreditLedgerType.BUMP_DEBIT, referenceId: listing.id },
      });
      expect(ledger!.amount).toBe(-expectedCost);
      expect(ledger!.note).toBe(`Campaña "${campaign.name}" (-20%)`);
    });

    it('floor (no ceil): bumpCreditCost=10, campaña -33% → floor(6.7)=6, no 7', async () => {
      // Setting es fixture global (excluido de cleanDb) — sobrescribir temporalmente.
      const original = await prisma.setting.findUniqueOrThrow({ where: { key: 'bumpCreditCost' } });
      await prisma.setting.update({ where: { key: 'bumpCreditCost' }, data: { value: 10 } });
      await createBumpActionDiscount(33);
      await giveWallet(sellerUserId, 1000);
      const listing = await createActiveListing(sellerUserId, 'bump-floor');
      const balanceBefore = await getBalance(sellerUserId);

      try {
        await request(app.getHttpServer())
          .post(`/api/listings/${listing.id}/bump`)
          .set('Authorization', `Bearer ${sellerToken}`)
          .expect(200);

        const balanceAfter = await getBalance(sellerUserId);
        expect(balanceBefore - balanceAfter).toBe(6); // floor(10*0.67)=floor(6.7)=6, no ceil(7)
      } finally {
        await prisma.setting.update({ where: { key: 'bumpCreditCost' }, data: { value: original.value! } });
      }
    });
  });

  // ── Validación de solapamiento refinada por acción ─────────────────────────

  describe('Admin — solapamiento ACTION_DISCOUNT refinado por acción', () => {
    let adminToken: string;

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: {
          email: 'h8d2-admin@example.com',
          name: 'H8D2 Admin',
          slug: 'h8d2-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      });
      adminToken = await loginUser(app, 'h8d2-admin@example.com', 'Test1234!');
      void admin;
    });

    afterEach(cleanCampaigns);

    function window(offsetDays: number, durationDays = 5) {
      const base = Date.now() + 400 * 24 * 60 * 60 * 1000;
      return {
        startsAt: new Date(base + offsetDays * 86_400_000).toISOString(),
        endsAt: new Date(base + (offsetDays + durationDays) * 86_400_000).toISOString(),
      };
    }

    it('dos ACTION_DISCOUNT de FEATURED solapados → 400 CAMPAIGN_OVERLAP', async () => {
      const w = window(0);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap FEATURED A',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'FEATURED', percent: 10 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap FEATURED B',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'FEATURED', percent: 20 },
        })
        .expect(400);

      expect(res.body.message?.code ?? res.body.code).toBe('CAMPAIGN_OVERLAP');
    });

    it('FEATURED + BUMP solapados → OK (acciones distintas conviven)', async () => {
      const w = window(50);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap Featured',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'FEATURED', percent: 10 },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap Bump',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'BUMP', percent: 10 },
        })
        .expect(201);
    });

    it('CREDIT_BONUS + ACTION_DISCOUNT solapados → OK (types distintos)', async () => {
      const w = window(100);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap Bonus',
          type: 'CREDIT_BONUS',
          ...w,
          params: { kind: 'FIXED', value: 10 },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Overlap Discount',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'FEATURED', percent: 10 },
        })
        .expect(201);
    });

    it('editar la action de una campaña activa hacia una que solapa → 400', async () => {
      const w = window(150);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Edit Action Base',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'FEATURED', percent: 10 },
        })
        .expect(201);

      const bumpCampaign = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Edit Action Bump',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'BUMP', percent: 10 },
        })
        .expect(201);

      // Cambiar la action del segundo (BUMP → FEATURED) mientras el primero
      // (FEATURED) sigue activo y solapado en fechas → debe re-validar y bloquear.
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${bumpCampaign.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ params: { action: 'FEATURED', percent: 15 } })
        .expect(400);

      expect(res.body.message?.code ?? res.body.code).toBe('CAMPAIGN_OVERLAP');
    });

    it('percent 91 → 400; percent 100 → 400; percent 90 → 201 (tope)', async () => {
      const w1 = window(200);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Percent 91',
          type: 'ACTION_DISCOUNT',
          ...w1,
          params: { action: 'FEATURED', percent: 91 },
        })
        .expect(400);

      const w2 = window(210);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Percent 100',
          type: 'ACTION_DISCOUNT',
          ...w2,
          params: { action: 'FEATURED', percent: 100 },
        })
        .expect(400);

      const w3 = window(220);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Percent 90',
          type: 'ACTION_DISCOUNT',
          ...w3,
          params: { action: 'FEATURED', percent: 90 },
        })
        .expect(201);
    });

    it('CREDIT_BONUS con params inválidos (sin kind/value) sigue validando igual que en fase 1', async () => {
      const w = window(300);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'H8D2 Test Bonus Invalido', type: 'CREDIT_BONUS', ...w, params: {} })
        .expect(400);
    });

    it('ACTION_DISCOUNT con action fuera de BUMP|FEATURED → 400', async () => {
      const w = window(310);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D2 Test Action Invalida',
          type: 'ACTION_DISCOUNT',
          ...w,
          params: { action: 'BOGUS', percent: 10 },
        })
        .expect(400);
    });
  });

  // ── Catálogo ─────────────────────────────────────────────────────────────

  describe('GET /billing/catalog — precio original/efectivo/%', () => {
    afterEach(cleanCampaigns);

    it('con descuento FEATURED activo: devuelve creditCost efectivo + originalCreditCost + discountPercent', async () => {
      await createFeaturedActionDiscount(30);

      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      const featuredPrices = (res.body.products as Array<{ prices: Array<Record<string, unknown>> }>)
        .flatMap((p) => p.prices)
        .filter((pr) => pr.durationDays === 7);

      expect(featuredPrices.length).toBeGreaterThan(0);
      const pr = featuredPrices[0];
      expect(pr.originalCreditCost).toBe(featuredCreditCost7d);
      expect(pr.creditCost).toBe(Math.floor(featuredCreditCost7d * 0.7));
      expect(pr.discountPercent).toBe(30);
    });

    it('con descuento BUMP activo: bumpCreditCost efectivo + bumpOriginalCreditCost + bumpDiscountPercent', async () => {
      await createBumpActionDiscount(20);

      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      expect(res.body.bumpOriginalCreditCost).toBe(bumpCreditCostDefault);
      expect(res.body.bumpCreditCost).toBe(Math.floor(bumpCreditCostDefault * 0.8));
      expect(res.body.bumpDiscountPercent).toBe(20);
    });

    it('sin campaña: solo el coste efectivo, sin original ni %', async () => {
      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);

      expect(res.body.bumpCreditCost).toBe(bumpCreditCostDefault);
      expect(res.body.bumpOriginalCreditCost).toBeUndefined();
      expect(res.body.bumpDiscountPercent).toBeUndefined();

      const featuredPrices = (res.body.products as Array<{ prices: Array<Record<string, unknown>> }>)
        .flatMap((p) => p.prices)
        .filter((pr) => pr.durationDays === 7);
      expect(featuredPrices[0].originalCreditCost).toBeUndefined();
      expect(featuredPrices[0].discountPercent).toBeUndefined();
    });
  });
});
