/**
 * RF.5 — Redsys wallet accreditation (e2e)
 *
 * These tests exercise the RedsysProcessor business logic directly, bypassing
 * HMAC signature verification (which requires real Redsys tooling / credentials).
 *
 * What IS verified:
 *   - Pack purchase wallet accreditation (create Wallet, increment balance, CreditLedger)
 *   - Idempotency layer 1: GatewayEvent @unique prevents enqueuing the same Ds_Order twice
 *   - Idempotency layer 2: processor guards on Transaction.status !== PENDING
 *   - Amount validation: mismatched Ds_Amount marks Transaction FAILED, wallet untouched
 *   - IVA breakdown: net + tax = gross for all pack prices (4.99 / 9.99 / 19.99)
 *   - Ds_Order format: each generated order is 12 chars, YYYYMMDD + 4 uppercase alphanum
 *   - Ds_Order collision retry: P2002 on first attempt triggers retry; second attempt succeeds
 *   - Ds_Order retry exhaustion: 3 consecutive collisions propagate the error
 *   - RF.10: POST /billing/checkout/credits-pack returns 201 + redsysFormData with 4 fields
 *
 * What is NOT verified here:
 *   - Real HMAC signature generation / verification against Redsys
 *   - Live notification from the Redsys sandbox
 *   (both require Redsys tooling / tunnel — pending RF.5 integration verification)
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient, TransactionStatus, CreditLedgerType, EntitlementType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { RedsysService } from 'src/modules/redsys/redsys.service';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

describe('Redsys — wallet accreditation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let redsysService: RedsysService;

  // IDs reused across tests in this describe block
  let userId: string;
  let packBasicoId: string;
  let packBasicoPriceId: string;
  let packBasicoCreditAmount: number; // 50
  let packBasicoAmountEur: Prisma.Decimal; // 4.99
  let httpToken: string; // JWT for the HTTP endpoint tests (RF.10)

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(RedsysProcessor);
    redsysService = app.get(RedsysService);

    // Create a test user
    const user = await prisma.user.create({
      data: {
        email: 'redsys-test@example.com',
        name: 'Redsys Test',
        slug: 'redsys-test',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;

    // Look up Pack Básico (seeded in seed-test.ts)
    const pack = await prisma.creditPack.findFirst({
      where: { name: 'Pack Básico' },
      include: { price: true },
    });
    if (!pack?.price) throw new Error('Pack Básico not found in test seed — run seed-test.ts');
    packBasicoId = pack.id;
    packBasicoPriceId = pack.price.id;
    packBasicoCreditAmount = pack.creditAmount; // 50
    packBasicoAmountEur = pack.price.amount;    // 4.99

    // Obtain a JWT for the HTTP-layer tests (RF.10) — reuses the user created above
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'redsys-test@example.com', password: 'Test1234!' });
    httpToken = loginRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Creates a PENDING Transaction that looks like it came from a Redsys checkout. */
  async function createPendingTransaction(
    dsOrder: string,
    overrides?: { userId?: string; bonusCreditAmount?: number | null },
  ) {
    const tax = redsysTaxBreakdown(packBasicoAmountEur);
    return prisma.transaction.create({
      data: {
        userId: overrides?.userId ?? userId,
        priceId: packBasicoPriceId,
        ...tax,
        status: TransactionStatus.PENDING,
        gateway: 'REDSYS',
        gatewayPaymentIntentId: dsOrder,
        bonusCreditAmount: overrides?.bonusCreditAmount ?? null,
      },
      select: { id: true, amountGross: true, gatewayPaymentIntentId: true },
    });
  }

  /** Amount in cents (string) that matches Transaction.amountGross. */
  function correctCents(amountEur: Prisma.Decimal): string {
    return amountEur.mul(100).toFixed(0);
  }

  // ── IVA breakdown ──────────────────────────────────────────────────────────

  describe('redsysTaxBreakdown', () => {
    const cases = [
      { label: 'Pack Básico 4.99 €',    gross: '4.99',  expectedNet: '4.12', expectedTax: '0.87' },
      { label: 'Pack Estándar 9.99 €',  gross: '9.99',  expectedNet: '8.26', expectedTax: '1.73' },
      { label: 'Pack Max 19.99 €',      gross: '19.99', expectedNet: '16.52', expectedTax: '3.47' },
    ];

    for (const { label, gross, expectedNet, expectedTax } of cases) {
      it(`${label}: net + tax = gross, correct 2-decimal split`, () => {
        const { amountGross, amountNet, taxAmount, taxRate } = redsysTaxBreakdown(gross);

        expect(amountGross.toFixed(2)).toBe(gross);
        expect(amountNet.toFixed(2)).toBe(expectedNet);
        expect(taxAmount.toFixed(2)).toBe(expectedTax);
        expect(taxRate.toFixed(4)).toBe('0.2100');

        // Core invariant: net + tax must equal gross (no rounding discrepancy)
        expect(amountNet.add(taxAmount).toFixed(2)).toBe(gross);
      });
    }
  });

  // ── Ds_Order format ────────────────────────────────────────────────────────

  describe('generateDsOrder', () => {
    it('produces correctly formatted orders (YYYYMMDD + 4 uppercase alphanum)', () => {
      for (let i = 0; i < 20; i++) {
        const order = redsysService.generateDsOrder();
        expect(order).toHaveLength(12);
        expect(order).toMatch(/^\d{8}[A-Z0-9]{4}$/);
      }
    });
  });

  // ── Ds_Order collision retry ────────────────────────────────────────────────

  describe('createCreditPackCheckout — Ds_Order collision retry', () => {
    const COLLIDING_ORDER = '20260627COLL';
    const UNIQUE_ORDER    = '20260627UNIQ';

    beforeEach(async () => {
      await prisma.transaction.deleteMany({
        where: { gatewayPaymentIntentId: { in: [COLLIDING_ORDER, UNIQUE_ORDER] } },
      });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.transaction.deleteMany({
        where: { gatewayPaymentIntentId: { in: [COLLIDING_ORDER, UNIQUE_ORDER] } },
      });
    });

    async function seedCollidingTransaction(): Promise<void> {
      const tax = redsysTaxBreakdown(packBasicoAmountEur);
      await prisma.transaction.create({
        data: {
          userId,
          priceId: packBasicoPriceId,
          ...tax,
          status: TransactionStatus.PENDING,
          gateway: 'REDSYS',
          gatewayPaymentIntentId: COLLIDING_ORDER,
        },
      });
    }

    it('retries on Ds_Order collision, succeeds on second attempt, logs warning', async () => {
      await seedCollidingTransaction();

      jest
        .spyOn(redsysService, 'generateDsOrder')
        .mockReturnValueOnce(COLLIDING_ORDER)
        .mockReturnValueOnce(UNIQUE_ORDER);

      // Bypass Redsys credentials — only the Transaction creation path matters here
      jest.spyOn(redsysService as any, 'buildForm').mockReturnValue({
        Ds_MerchantParameters: 'mock',
        Ds_SignatureVersion: 'HMAC_SHA256_V1',
        Ds_Signature: 'mock',
        tpvUrl: 'https://mock.tpv.redsys.com/',
      });

      const warnSpy = jest.spyOn((redsysService as any).logger, 'warn');

      const result = await redsysService.createCreditPackCheckout(userId, { packId: packBasicoId });
      expect(result.redsysFormData).toBeDefined();

      // Transaction must have been persisted under the second (unique) Ds_Order
      const tx = await prisma.transaction.findUnique({
        where: { gatewayPaymentIntentId: UNIQUE_ORDER },
      });
      expect(tx).not.toBeNull();
      expect(tx!.status).toBe(TransactionStatus.PENDING);

      // The collision warning proves the retry path was actually exercised
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('collision on attempt 1'));
    });

    it('propagates P2002 after exhausting all 3 attempts when every Ds_Order collides', async () => {
      await seedCollidingTransaction();

      jest.spyOn(redsysService, 'generateDsOrder').mockReturnValue(COLLIDING_ORDER);

      await expect(
        redsysService.createCreditPackCheckout(userId, { packId: packBasicoId }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // No new Transaction was created — only the pre-seeded one exists
      const count = await prisma.transaction.count({
        where: { gatewayPaymentIntentId: COLLIDING_ORDER },
      });
      expect(count).toBe(1);
    });
  });

  // ── Wallet accreditation ───────────────────────────────────────────────────

  describe('processSuccess — pack purchase', () => {
    const DS_ORDER = '20260626ACCR';

    beforeEach(async () => {
      // Clean wallet + related data before each accreditation test so tests are independent
      await prisma.creditLedger.deleteMany({ where: { wallet: { userId } } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.transaction.deleteMany({ where: { gatewayPaymentIntentId: DS_ORDER } });
      await prisma.gatewayEvent.deleteMany({ where: { gatewayEventId: DS_ORDER } });
    });

    it('creates Wallet, increments balance, writes CreditLedger, marks Transaction SUCCEEDED', async () => {
      const tx = await createPendingTransaction(DS_ORDER);
      const cents = correctCents(packBasicoAmountEur);

      await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder: DS_ORDER });

      // Transaction is SUCCEEDED
      const txAfter = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(txAfter?.status).toBe(TransactionStatus.SUCCEEDED);

      // Wallet was created with correct balance
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
        include: { entries: true },
      });
      expect(wallet).not.toBeNull();
      expect(wallet!.balance).toBe(packBasicoCreditAmount); // 50

      // Exactly one CreditLedger entry
      expect(wallet!.entries).toHaveLength(1);
      const entry = wallet!.entries[0]!;
      expect(entry.type).toBe(CreditLedgerType.PACK_PURCHASE);
      expect(entry.amount).toBe(packBasicoCreditAmount); // +50
      expect(entry.referenceType).toBe('Transaction');
      expect(entry.referenceId).toBe(tx.id);
    });

    it('accumulates balance on repeated purchases (wallet already exists)', async () => {
      // First pack purchase
      const tx1 = await createPendingTransaction(DS_ORDER);
      await processor.processSuccess({
        transactionId: tx1.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: DS_ORDER,
      });

      const secondOrder = DS_ORDER + '2';
      await prisma.transaction.deleteMany({ where: { gatewayPaymentIntentId: secondOrder } });
      const tx2 = await createPendingTransaction(secondOrder);
      await processor.processSuccess({
        transactionId: tx2.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: secondOrder,
      });

      const wallet = await prisma.wallet.findUnique({
        where: { userId },
        include: { entries: true },
      });
      expect(wallet!.balance).toBe(packBasicoCreditAmount * 2); // 100
      expect(wallet!.entries).toHaveLength(2);
    });
  });

  // ── Idempotency layer 1 (GatewayEvent) ─────────────────────────────────────

  describe('Idempotency layer 1 — GatewayEvent @unique', () => {
    const DS_ORDER = '20260626IDEM';

    afterEach(async () => {
      await prisma.gatewayEvent.deleteMany({ where: { gatewayEventId: DS_ORDER } });
    });

    it('first GatewayEvent insert succeeds', async () => {
      const created = await prisma.gatewayEvent.create({
        data: { gatewayEventId: DS_ORDER, eventType: 'redsys.notification', gateway: 'REDSYS' },
      });
      expect(created.gatewayEventId).toBe(DS_ORDER);
    });

    it('second insert with the same Ds_Order throws P2002 (unique violation)', async () => {
      await prisma.gatewayEvent.create({
        data: { gatewayEventId: DS_ORDER, eventType: 'redsys.notification', gateway: 'REDSYS' },
      });

      // The guard catches P2002 and returns 200 without enqueuing — verified here at DB level
      await expect(
        prisma.gatewayEvent.create({
          data: { gatewayEventId: DS_ORDER, eventType: 'redsys.notification', gateway: 'REDSYS' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ── Idempotency layer 2 (processor) ────────────────────────────────────────

  describe('Idempotency layer 2 — processor guards on Transaction.status', () => {
    const DS_ORDER = '20260626IDMX';

    beforeAll(async () => {
      await prisma.creditLedger.deleteMany({ where: { wallet: { userId } } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.transaction.deleteMany({ where: { gatewayPaymentIntentId: DS_ORDER } });
    });

    it('processing the same job twice does not duplicate credits', async () => {
      const tx = await createPendingTransaction(DS_ORDER);
      const cents = correctCents(packBasicoAmountEur);

      // First call — normal processing
      await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder: DS_ORDER });

      const walletAfterFirst = await prisma.wallet.findUnique({
        where: { userId },
        include: { entries: true },
      });
      expect(walletAfterFirst!.balance).toBe(packBasicoCreditAmount);
      expect(walletAfterFirst!.entries).toHaveLength(1);

      // Second call — processor sees status = SUCCEEDED and returns early
      await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder: DS_ORDER });

      const walletAfterSecond = await prisma.wallet.findUnique({
        where: { userId },
        include: { entries: true },
      });
      // Balance and ledger entries must be identical after the second call
      expect(walletAfterSecond!.balance).toBe(packBasicoCreditAmount); // still 50, not 100
      expect(walletAfterSecond!.entries).toHaveLength(1);              // still 1 entry
    });
  });

  // ── Amount validation ──────────────────────────────────────────────────────

  describe('Amount validation', () => {
    const DS_ORDER = '20260626AMNT';

    beforeEach(async () => {
      await prisma.creditLedger.deleteMany({ where: { wallet: { userId } } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.transaction.deleteMany({ where: { gatewayPaymentIntentId: DS_ORDER } });
    });

    it('marks Transaction FAILED and leaves Wallet untouched when Ds_Amount does not match', async () => {
      const tx = await createPendingTransaction(DS_ORDER);
      const correctCentsValue = correctCents(packBasicoAmountEur); // "499"
      const wrongCents = String(parseInt(correctCentsValue, 10) + 1); // "500"

      await processor.processSuccess({ transactionId: tx.id, dsAmount: wrongCents, dsOrder: DS_ORDER });

      const txAfter = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(txAfter?.status).toBe(TransactionStatus.FAILED);

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet).toBeNull(); // No wallet was created
    });

    it('processes correctly when amount matches exactly', async () => {
      const tx = await createPendingTransaction(DS_ORDER);
      const cents = correctCents(packBasicoAmountEur);

      await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder: DS_ORDER });

      const txAfter = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(txAfter?.status).toBe(TransactionStatus.SUCCEEDED);

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.balance).toBe(packBasicoCreditAmount);
    });
  });

  // ── Non-existent transaction ───────────────────────────────────────────────

  describe('Edge cases', () => {
    it('logs error and returns without throwing when transactionId is unknown', async () => {
      // Should not throw — processor logs the error and exits cleanly
      await expect(
        processor.processSuccess({
          transactionId: 'nonexistent-id-xyz',
          dsAmount: '499',
          dsOrder: '20260626EDGX',
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── RF.10 — HTTP endpoint shape ────────────────────────────────────────────
  // Verifies the full HTTP response from POST /billing/checkout/credits-pack.
  // REDSYS_SECRET_KEY is available in .env.test (dummy key), so buildForm runs
  // for real — no mocks. This validates the actual HMAC-SHA256 signing mechanics.

  describe('RF.10 — POST /billing/checkout/credits-pack (HTTP layer)', () => {
    it('returns 201 and buildForm produces a real signed redsysFormData', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${httpToken}`)
        .send({ packId: packBasicoId })
        .expect(201);

      expect(res.body).toHaveProperty('redsysFormData');
      const { redsysFormData } = res.body as { redsysFormData: Record<string, string> };

      // Protocol fixed value
      expect(redsysFormData.Ds_SignatureVersion).toBe('HMAC_SHA256_V1');

      // Real HMAC-SHA256 signature with dummy key: base64 of 32 raw bytes = 44 chars
      expect(redsysFormData.Ds_Signature).toHaveLength(44);

      // Sandbox TPV redirect URL (from SANDBOX_URLS.redirect in redsys-easy)
      expect(redsysFormData.tpvUrl).toBe('https://sis-t.redsys.es:25443/sis/realizarPago');

      // Ds_MerchantParameters is base64-encoded JSON — decode and verify merchant params
      const decoded = Buffer.from(redsysFormData.Ds_MerchantParameters, 'base64').toString('utf8');
      const params = JSON.parse(decoded) as Record<string, string>;
      expect(params.DS_MERCHANT_AMOUNT).toBe('499');           // Pack Básico = 4.99 € = 499 cents
      expect(params.DS_MERCHANT_CURRENCY).toBe('978');         // EUR
      expect(params.DS_MERCHANT_MERCHANTCODE).toBe('999008881');
      expect(params.DS_MERCHANT_URLOK).toContain('/mis-creditos/exito');
      expect(params.DS_MERCHANT_URLKO).toContain('/mis-creditos/error');
      expect(params.DS_MERCHANT_ORDER).toMatch(/^\d{8}[A-Z0-9]{4}$/); // YYYYMMDD + 4 alphanum

      // A PENDING Transaction must have been created
      const tx = await prisma.transaction.findFirst({
        where: { userId, gateway: 'REDSYS', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      expect(tx).not.toBeNull();
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .send({ packId: packBasicoId })
        .expect(401);
    });

    it('returns 400 when packId is missing (DTO validation fires before buildForm)', async () => {
      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${httpToken}`)
        .send({})
        .expect(400);
    });
  });

  // ── Bonus Pro (RF.10 §2.5) ────────────────────────────────────────────────
  //
  // Pack Básico has creditAmount=50. With proExtraCreditsPercent=20 (seeded):
  //   bonus = ceil(50 * 20 / 100) = ceil(10) = 10 → total = 60
  //
  // The "rounding" test uses a synthetic pack with creditAmount=51:
  //   bonus = ceil(51 * 20 / 100) = ceil(10.2) = 11 → exercises the ceil branch.
  // With current real packs (50/150/400) × 20% the result is always integer,
  // so the ceil guard is not exercised in production — it is here for safety.

  describe('Bonus Pro — checkout freezes bonus and processor applies it', () => {
    let proUserId: string;
    let roundingPackId: string;
    let roundingPriceId: string;

    const PRO_BONUS_PCT = 20; // must match seed-test.ts proExtraCreditsPercent

    beforeAll(async () => {
      // Create a Pro user (separate from the base user to avoid state contamination).
      const proUser = await prisma.user.create({
        data: {
          email: 'redsys-pro@example.com',
          name: 'Redsys Pro',
          slug: 'redsys-pro',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      proUserId = proUser.id;

      // Grant active PRO_SUBSCRIPTION (30 days from now).
      await prisma.entitlement.create({
        data: {
          userId: proUserId,
          type: EntitlementType.PRO_SUBSCRIPTION,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Synthetic pack for the ceil rounding test: creditAmount=51.
      // 51 * 20 / 100 = 10.2 → ceil → 11. Requires an existing Product.
      const packsProduct = await prisma.product.findFirst({
        where: { name: 'Packs de créditos' },
      });
      if (!packsProduct) throw new Error('Packs de créditos product not found in test seed');

      const roundPack = await prisma.creditPack.create({
        data: { name: 'Pack Rounding Test', creditAmount: 51, active: true },
      });
      const roundPrice = await prisma.price.create({
        data: {
          productId: packsProduct.id,
          amount: new Prisma.Decimal('4.99'),
          creditPackId: roundPack.id,
        },
      });
      roundingPackId = roundPack.id;
      roundingPriceId = roundPrice.id;
    });

    afterAll(async () => {
      await prisma.creditLedger.deleteMany({ where: { wallet: { userId: proUserId } } });
      await prisma.wallet.deleteMany({ where: { userId: proUserId } });
      await prisma.transaction.deleteMany({ where: { userId: proUserId } });
      await prisma.entitlement.deleteMany({ where: { userId: proUserId } });
      await prisma.user.delete({ where: { id: proUserId } });
      await prisma.price.deleteMany({ where: { creditPackId: roundingPackId } });
      await prisma.creditPack.delete({ where: { id: roundingPackId } });
    });

    // ── Checkout: freeze tests ─────────────────────────────────────────────

    describe('createCreditPackCheckout — bonus freeze', () => {
      const MOCK_FORM = {
        Ds_MerchantParameters: 'mock',
        Ds_SignatureVersion: 'HMAC_SHA256_V1',
        Ds_Signature: 'mock',
        tpvUrl: 'https://mock.tpv/',
      };

      afterEach(async () => {
        jest.restoreAllMocks();
        await prisma.transaction.deleteMany({ where: { userId: proUserId } });
      });

      it('Pro user: Transaction is created with bonusCreditAmount = ceil(base × pct/100)', async () => {
        jest.spyOn(redsysService as any, 'buildForm').mockReturnValue(MOCK_FORM);

        await redsysService.createCreditPackCheckout(proUserId, { packId: packBasicoId });

        const tx = await prisma.transaction.findFirst({
          where: { userId: proUserId, gateway: 'REDSYS', status: TransactionStatus.PENDING },
          orderBy: { createdAt: 'desc' },
        });
        expect(tx).not.toBeNull();
        const expectedBonus = Math.ceil(packBasicoCreditAmount * PRO_BONUS_PCT / 100); // ceil(50*20/100)=10
        expect(tx!.bonusCreditAmount).toBe(expectedBonus);
      });

      it('Non-Pro user: Transaction is created with bonusCreditAmount = null', async () => {
        jest.spyOn(redsysService as any, 'buildForm').mockReturnValue(MOCK_FORM);

        // userId (not proUserId) has no PRO_SUBSCRIPTION
        await redsysService.createCreditPackCheckout(userId, { packId: packBasicoId });

        const tx = await prisma.transaction.findFirst({
          where: { userId, gateway: 'REDSYS', status: TransactionStatus.PENDING },
          orderBy: { createdAt: 'desc' },
        });
        expect(tx).not.toBeNull();
        expect(tx!.bonusCreditAmount).toBeNull();
      });

      it('Ceil rounding: creditAmount=51 with 20% → bonusCreditAmount=11 (ceil of 10.2)', async () => {
        jest.spyOn(redsysService as any, 'buildForm').mockReturnValue(MOCK_FORM);

        await redsysService.createCreditPackCheckout(proUserId, { packId: roundingPackId });

        const tx = await prisma.transaction.findFirst({
          where: { userId: proUserId, gateway: 'REDSYS', status: TransactionStatus.PENDING },
          orderBy: { createdAt: 'desc' },
        });
        expect(tx).not.toBeNull();
        // 51 * 20 / 100 = 10.2 → ceil → 11
        expect(tx!.bonusCreditAmount).toBe(11);
      });
    });

    // ── Processor: accreditation tests ────────────────────────────────────

    describe('processSuccess — Pro bonus accreditation', () => {
      const DS_ORDER_PRO     = '20260627PROB';
      const DS_ORDER_NONPRO  = '20260627NOPR';

      beforeEach(async () => {
        await prisma.creditLedger.deleteMany({ where: { wallet: { userId: proUserId } } });
        await prisma.wallet.deleteMany({ where: { userId: proUserId } });
        await prisma.transaction.deleteMany({
          where: { gatewayPaymentIntentId: { in: [DS_ORDER_PRO, DS_ORDER_NONPRO] } },
        });
      });

      it('Pro user: wallet = base + bonus, two CreditLedger entries (PACK_PURCHASE + PRO_BONUS)', async () => {
        const expectedBonus = Math.ceil(packBasicoCreditAmount * PRO_BONUS_PCT / 100); // 10
        const expectedTotal = packBasicoCreditAmount + expectedBonus; // 60

        // Transaction with bonus pre-frozen (simulating what checkout would store).
        const tx = await createPendingTransaction(DS_ORDER_PRO, {
          userId: proUserId,
          bonusCreditAmount: expectedBonus,
        });

        await processor.processSuccess({
          transactionId: tx.id,
          dsAmount: correctCents(packBasicoAmountEur),
          dsOrder: DS_ORDER_PRO,
        });

        const txAfter = await prisma.transaction.findUnique({ where: { id: tx.id } });
        expect(txAfter?.status).toBe(TransactionStatus.SUCCEEDED);

        const wallet = await prisma.wallet.findUnique({
          where: { userId: proUserId },
          include: { entries: { orderBy: { createdAt: 'asc' } } },
        });
        expect(wallet).not.toBeNull();
        expect(wallet!.balance).toBe(expectedTotal); // 60

        expect(wallet!.entries).toHaveLength(2);

        const packEntry = wallet!.entries.find((e) => e.type === CreditLedgerType.PACK_PURCHASE);
        expect(packEntry).toBeDefined();
        expect(packEntry!.amount).toBe(packBasicoCreditAmount); // +50
        expect(packEntry!.referenceType).toBe('Transaction');
        expect(packEntry!.referenceId).toBe(tx.id);

        const bonusEntry = wallet!.entries.find((e) => e.type === CreditLedgerType.PRO_BONUS);
        expect(bonusEntry).toBeDefined();
        expect(bonusEntry!.amount).toBe(expectedBonus); // +10
        expect(bonusEntry!.referenceType).toBe('Transaction');
        expect(bonusEntry!.referenceId).toBe(tx.id); // same Transaction as base
      });

      it('Non-Pro user: wallet = base only, one CreditLedger entry (no PRO_BONUS)', async () => {
        // Reuse base userId (no Pro entitlement). Clean its wallet state too.
        await prisma.creditLedger.deleteMany({ where: { wallet: { userId } } });
        await prisma.wallet.deleteMany({ where: { userId } });

        const tx = await createPendingTransaction(DS_ORDER_NONPRO, { bonusCreditAmount: null });

        await processor.processSuccess({
          transactionId: tx.id,
          dsAmount: correctCents(packBasicoAmountEur),
          dsOrder: DS_ORDER_NONPRO,
        });

        const wallet = await prisma.wallet.findUnique({
          where: { userId },
          include: { entries: true },
        });
        expect(wallet).not.toBeNull();
        expect(wallet!.balance).toBe(packBasicoCreditAmount); // 50

        expect(wallet!.entries).toHaveLength(1);
        expect(wallet!.entries[0]!.type).toBe(CreditLedgerType.PACK_PURCHASE);
        expect(wallet!.entries.find((e) => e.type === CreditLedgerType.PRO_BONUS)).toBeUndefined();
      });
    });
  });

  // ── RF.11 — POST /billing/checkout/featured-pay (HTTP layer) ──────────────
  //
  // Verifies that the checkout for a direct Redsys payment of a featured listing
  // uses /mis-anuncios/destacado-exito|error as URLOK/URLKO (not /mis-creditos/*).

  describe('RF.11 — POST /billing/checkout/featured-pay (HTTP layer)', () => {
    let featuredPriceId: string;
    let featuredListingId: string;

    beforeAll(async () => {
      // Find the seeded featured listing price (7d) — must exist in seed-test.ts
      const featuredPrice = await prisma.price.findFirst({
        where: { active: true, durationDays: { not: null } },
        select: { id: true },
      });
      if (!featuredPrice) throw new Error('No featured price found in seed — run seed-test.ts');
      featuredPriceId = featuredPrice.id;

      // Create an ACTIVE listing owned by the http test user
      const category = await prisma.category.findFirst({ select: { id: true } });
      const listing = await prisma.listing.create({
        data: {
          title: 'Test featured listing RF.11',
          slug: 'test-featured-listing-rf11',
          description: 'RF.11 e2e test listing',
          price: new Prisma.Decimal('50.00'),
          currency: 'EUR',
          priceType: 'FIXED',
          type: 'PRODUCT',
          status: 'ACTIVE',
          sellerId: userId,
          categoryId: category!.id,
        },
      });
      featuredListingId = listing.id;
    });

    afterAll(async () => {
      await prisma.transaction.deleteMany({ where: { listingId: featuredListingId } });
      await prisma.listing.delete({ where: { id: featuredListingId } });
    });

    it('returns 201 and URLOK/URLKO point to /mis-anuncios/destacado-*', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/billing/checkout/featured-pay')
        .set('Authorization', `Bearer ${httpToken}`)
        .send({ priceId: featuredPriceId, listingId: featuredListingId })
        .expect(201);

      expect(res.body).toHaveProperty('redsysFormData');
      const { redsysFormData } = res.body as { redsysFormData: Record<string, string> };

      const decoded = Buffer.from(redsysFormData.Ds_MerchantParameters, 'base64').toString('utf8');
      const params = JSON.parse(decoded) as Record<string, string>;
      expect(params.DS_MERCHANT_URLOK).toContain('/mis-anuncios/destacado-exito');
      expect(params.DS_MERCHANT_URLKO).toContain('/mis-anuncios/destacado-error');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post('/api/billing/checkout/featured-pay')
        .send({ priceId: featuredPriceId, listingId: featuredListingId })
        .expect(401);
    });

    it('returns 400 when priceId is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/billing/checkout/featured-pay')
        .set('Authorization', `Bearer ${httpToken}`)
        .send({ listingId: featuredListingId })
        .expect(400);
    });
  });
});
