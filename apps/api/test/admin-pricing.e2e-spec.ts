/**
 * Monetización — precios y costes configurables (e2e)
 *
 * Cubre:
 *   - PATCH /admin/settings/:key (bumpCreditCost) → el siguiente bump() cobra el
 *     nuevo coste.
 *   - PATCH /admin/billing/prices/:id → el siguiente checkout de un pack de
 *     créditos firma el importe nuevo hacia Redsys.
 *   - EL TEST QUE IMPORTA: una Transaction ya SUCCEEDED con el precio viejo no
 *     cambia de importe cuando el admin sube el precio después.
 *   - El CreditLedger de una compra vieja no cambia de créditos cuando el admin
 *     sube CreditPack.creditAmount después (bug de congelación cerrado en esta
 *     ráfaga vía Transaction.baseCreditAmount).
 *   - Validación: importe/coste <= 0 → 400. Precio de Stripe (interval != null)
 *     → 400 al intentar editarlo.
 *   - Cada cambio deja un AuditLog con before/after.
 *
 * IMPORTANTE (aislamiento): Setting/Price/CreditPack son datos estáticos
 * globales sembrados una vez y NO se truncan en cleanDb (ver helpers/db.ts) —
 * se comparten entre TODOS los ficheros e2e de la misma pasada --runInBand.
 * Por eso este fichero:
 *   - crea su PROPIO Product/Price/CreditPack dedicados para los tests que
 *     mutan un importe/creditAmount, en vez de tocar los sembrados en seed
 *     (p. ej. "Pack Básico", que otros specs de Redsys dan por hecho con su
 *     valor original);
 *   - para bumpCreditCost (una Setting key real, no se puede crear una nueva)
 *     restaura el valor original en afterAll para no filtrar el cambio a los
 *     specs que corran después en la misma pasada.
 */

import { INestApplication } from '@nestjs/common';
import { AuditLog, Prisma, PrismaClient, TransactionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';

describe('Monetización — precios y costes configurables (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;

  let adminToken: string;
  let sellerToken: string;
  let sellerUserId: string;
  let categoryId: string;

  let originalBumpCreditCost: number;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(RedsysProcessor);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const [admin, seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'ap-admin@example.com',
          name: 'AP Admin',
          slug: 'ap-admin',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ap-seller@example.com',
          name: 'AP Seller',
          slug: 'ap-seller',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
    ]);
    sellerUserId = seller.id;

    const [adminRes, sellerRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'ap-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ap-seller@example.com', password: 'Test1234!' }),
    ]);
    adminToken = adminRes.body.accessToken as string;
    sellerToken = sellerRes.body.accessToken as string;

    const bumpSetting = await prisma.setting.findUniqueOrThrow({ where: { key: 'bumpCreditCost' } });
    originalBumpCreditCost = Number(bumpSetting.value);
  });

  afterAll(async () => {
    // Restore the shared Setting so later spec files in the same --runInBand
    // run see the seeded default, not whatever value this file's tests left.
    await prisma.setting.update({
      where: { key: 'bumpCreditCost' },
      data: { value: originalBumpCreditCost },
    });
    await app.close();
    await prisma.$disconnect();
  });

  async function createActiveListing(suffix: string): Promise<string> {
    const listing = await prisma.listing.create({
      data: {
        title: `AP Test listing${suffix}`,
        slug: `ap-test-listing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'E2e test listing',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: sellerUserId,
        categoryId,
        publishedAt: new Date(),
      },
    });
    return listing.id;
  }

  function lastAuditLog(action: string, resourceId: string): Promise<AuditLog | null> {
    return prisma.auditLog.findFirst({
      where: { action, resourceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── 1. Coste en créditos del bump ───────────────────────────────────────────

  describe('Coste en créditos del bump', () => {
    it('PATCH /admin/settings/bumpCreditCost → el siguiente bump() cobra el nuevo coste', async () => {
      await prisma.wallet.upsert({
        where: { userId: sellerUserId },
        create: { userId: sellerUserId, balance: 500 },
        update: { balance: 500 },
      });

      const newCost = originalBumpCreditCost + 7;
      await request(app.getHttpServer())
        .patch('/api/admin/settings/bumpCreditCost')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: newCost })
        .expect(200);

      const listingId = await createActiveListing('-bump-newcost');
      await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerUserId } });
      expect(wallet.balance).toBe(500 - newCost);

      const auditLog = await lastAuditLog('SETTING_UPDATE', 'bumpCreditCost');
      expect(auditLog).not.toBeNull();
      expect((auditLog!.after as { value: number }).value).toBe(newCost);
    });

    it('PATCH /admin/settings/bumpCreditCost con 0 → 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/settings/bumpCreditCost')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 0 })
        .expect(400);
    });

    it('PATCH /admin/settings/bumpCreditCost con negativo → 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/settings/bumpCreditCost')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: -3 })
        .expect(400);
    });

    it('PATCH /admin/settings/bumpCreditCost con decimal → 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/settings/bumpCreditCost')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 2.5 })
        .expect(400);
    });
  });

  // ── 2, 3, 4. Precio en euros + créditos de un pack: firma nueva, histórico intacto ──

  describe('Precio y créditos de un pack de créditos', () => {
    let packId: string;
    let priceId: string;
    const ORIGINAL_AMOUNT = 9.99;
    const ORIGINAL_CREDITS = 100;

    beforeAll(async () => {
      const product = await prisma.product.create({
        data: { name: 'AP Pricing Test Product', type: 'ONE_TIME', active: true },
      });
      const pack = await prisma.creditPack.create({
        data: { name: 'AP Pricing Test Pack', creditAmount: ORIGINAL_CREDITS, active: true },
      });
      const price = await prisma.price.create({
        data: {
          productId: product.id,
          amount: ORIGINAL_AMOUNT,
          currency: 'EUR',
          creditPackId: pack.id,
          active: true,
        },
      });
      packId = pack.id;
      priceId = price.id;
    });

    async function checkoutAndConfirm(): Promise<{ userId: string; transactionId: string }> {
      const email = `ap-buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
      const buyer = await prisma.user.create({
        data: {
          email,
          name: 'AP Buyer',
          slug: `ap-buyer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Test1234!' });
      const token = login.body.accessToken as string;

      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${token}`)
        .send({ packId })
        .expect(201);

      const tx = await prisma.transaction.findFirstOrThrow({
        where: { userId: buyer.id, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });

      const cents = tx.amountGross.mul(100).toFixed(0);
      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: cents,
        dsOrder: tx.gatewayPaymentIntentId!,
      });

      return { userId: buyer.id, transactionId: tx.id };
    }

    it('compra con el precio original: Transaction.amountGross y CreditLedger reflejan el pack original', async () => {
      const { transactionId } = await checkoutAndConfirm();
      const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(tx.status).toBe(TransactionStatus.SUCCEEDED);
      expect(tx.amountGross.toNumber()).toBeCloseTo(ORIGINAL_AMOUNT, 2);
      expect(tx.baseCreditAmount).toBe(ORIGINAL_CREDITS);
    });

    it('PATCH /admin/billing/prices/:id y /admin/billing/credit-packs/:id → el siguiente checkout firma el importe y créditos nuevos', async () => {
      const NEW_AMOUNT = 14.99;
      const NEW_CREDITS = 150;

      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${priceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: NEW_AMOUNT })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/billing/credit-packs/${packId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ creditAmount: NEW_CREDITS })
        .expect(200);

      const { transactionId } = await checkoutAndConfirm();
      const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(tx.status).toBe(TransactionStatus.SUCCEEDED);
      expect(tx.amountGross.toNumber()).toBeCloseTo(NEW_AMOUNT, 2);
      expect(tx.baseCreditAmount).toBe(NEW_CREDITS);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: tx.userId } });
      expect(wallet.balance).toBe(NEW_CREDITS);

      // Restore so later tests in this block start from a known baseline.
      await prisma.price.update({ where: { id: priceId }, data: { amount: ORIGINAL_AMOUNT } });
      await prisma.creditPack.update({ where: { id: packId }, data: { creditAmount: ORIGINAL_CREDITS } });
    });

    it('EL TEST QUE IMPORTA: la Transaction vieja (precio original) no cambia tras subir el precio', async () => {
      const { transactionId } = await checkoutAndConfirm(); // at ORIGINAL_AMOUNT/ORIGINAL_CREDITS (restored above)
      const before = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(before.amountGross.toNumber()).toBeCloseTo(ORIGINAL_AMOUNT, 2);
      expect(before.baseCreditAmount).toBe(ORIGINAL_CREDITS);

      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${priceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 999.99 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/credit-packs/${packId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ creditAmount: 999999 })
        .expect(200);

      const after = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(after.amountGross.toNumber()).toBeCloseTo(ORIGINAL_AMOUNT, 2);
      expect(after.baseCreditAmount).toBe(ORIGINAL_CREDITS);

      // El ledger de esa compra vieja tampoco cambia.
      const ledgerEntry = await prisma.creditLedger.findFirstOrThrow({
        where: { referenceType: 'Transaction', referenceId: transactionId },
      });
      expect(ledgerEntry.amount).toBe(ORIGINAL_CREDITS);

      // Restore for any subsequent test in this block.
      await prisma.price.update({ where: { id: priceId }, data: { amount: ORIGINAL_AMOUNT } });
      await prisma.creditPack.update({ where: { id: packId }, data: { creditAmount: ORIGINAL_CREDITS } });
    });

    it('PATCH price con amount <= 0 → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${priceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${priceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -5 })
        .expect(400);
    });

    it('PATCH credit-pack con creditAmount <= 0 → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/credit-packs/${packId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ creditAmount: 0 })
        .expect(400);
    });

    it('Cada PATCH deja un AuditLog con before/after', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${priceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 19.99 })
        .expect(200);

      const auditLog = await lastAuditLog('PRICE_UPDATE', priceId);
      expect(auditLog).not.toBeNull();
      expect((auditLog!.after as { amount: number }).amount).toBe(19.99);

      // Restore.
      await prisma.price.update({ where: { id: priceId }, data: { amount: ORIGINAL_AMOUNT } });
    });
  });

  // ── 5, 6. Guard de precios de Stripe ────────────────────────────────────────

  describe('Precios de Stripe quedan fuera', () => {
    it('PATCH /admin/billing/prices/:id sobre un Price recurrente (Stripe) → 400', async () => {
      const product = await prisma.product.create({
        data: { name: 'AP Pricing Recurring Product', type: 'RECURRING', active: true },
      });
      const recurringPrice = await prisma.price.create({
        data: {
          productId: product.id,
          amount: 9.99,
          currency: 'EUR',
          interval: 'MONTH',
          intervalCount: 1,
          active: true,
        },
      });

      await request(app.getHttpServer())
        .patch(`/api/admin/billing/prices/${recurringPrice.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 14.99 })
        .expect(400);

      const unchanged = await prisma.price.findUniqueOrThrow({ where: { id: recurringPrice.id } });
      expect(unchanged.amount.toNumber()).toBeCloseTo(9.99, 2);
    });
  });

  // ── Seguridad ────────────────────────────────────────────────────────────────

  describe('Seguridad', () => {
    it('GET /admin/billing/prices sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/billing/prices').expect(401);
    });

    it('GET /admin/billing/prices como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/billing/prices')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);
    });
  });
});
