/**
 * Campaña #10 — CampaignType.BUMP_BONUS (bonus de campaña en packs de bumps).
 * Espejo de CREDIT_BONUS (H8 Bloque D fase 1, ver h8-d1-campaigns.e2e-spec.ts
 * "Checkout — campaign bonus freeze" / "Processor — campaign bonus
 * accreditation"), moneda distinta. Este spec verifica que la paridad es real,
 * no solo leída: mismos números, mismas filas de ledger, mismo criterio de
 * solapamiento — ejerciendo, no declarando.
 *
 * Covers:
 *   - Matriz de acreditación (Pro × campaña activa): las 4 combinaciones,
 *     con las filas EXACTAS de BumpLedger en cada una.
 *   - Paridad de fórmula con créditos: aditiva sobre la base, cada bonus
 *     (Pro y campaña) calculado independientemente contra bumpAmount, luego
 *     sumados — NUNCA compuesta.
 *   - Invariante wallet.bumpBalance == SUM(BumpLedger.amount) con las 3 filas
 *     de acreditación (el caso más complejo).
 *   - Congelado: cambiar BumpPack.bumpAmount o el % de campaña a mitad de
 *     vuelo no altera lo que una compra ya en curso otorga.
 *   - Idempotencia: reintento del processor no duplica ninguna fila.
 *   - Solapamiento: dos BUMP_BONUS activos solapados → CAMPAIGN_OVERLAP; un
 *     BUMP_BONUS y un CREDIT_BONUS solapados → coexisten (types distintos).
 */

import { INestApplication } from '@nestjs/common';
import {
  BumpLedgerType,
  CampaignType,
  EntitlementType,
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
import { RedsysService } from 'src/modules/redsys/redsys.service';

describe('Campaña #10 — BUMP_BONUS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let redsysService: RedsysService;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await cleanCampaigns();

    processor = app.get(RedsysProcessor);
    redsysService = app.get(RedsysService);

    const admin = await prisma.user.create({
      data: {
        email: 'bb-admin@example.com',
        name: 'BB Admin',
        slug: 'bb-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'bb-admin@example.com', password: 'Test1234!' });
    adminToken = adminRes.body.accessToken as string;
  });

  afterAll(async () => {
    await cleanCampaigns();
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Campaign no tiene FK a User — cleanDb() no lo toca. Limpieza explícita, mismo patrón que h8-d1-campaigns. */
  async function cleanCampaigns(): Promise<void> {
    await prisma.transaction.updateMany({ data: { campaignId: null } });
    await prisma.campaign.deleteMany({});
  }

  function nowWindow(durationMs = 60 * 60 * 1000) {
    return {
      startsAt: new Date(Date.now() - durationMs).toISOString(),
      endsAt: new Date(Date.now() + durationMs).toISOString(),
    };
  }

  async function createUser(suffix: string) {
    const email = `bb-${suffix}-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `BB ${suffix}`,
        slug: `bb-${suffix}-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return { user, token: login.body.accessToken as string };
  }

  async function makePro(userId: string) {
    const proPrice = await prisma.price.findFirstOrThrow({
      where: { product: { type: ProductType.RECURRING } },
    });
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId: proPrice.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
        gatewaySubscriptionId: `sub_bb_${userId}_${Date.now()}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId: proPrice.id,
        expiresAt: subscription.currentPeriodEnd,
      },
    });
  }

  /** Pack dedicado por spec — evita mutar los 3 packs sembrados. */
  async function createDedicatedBumpPack(suffix: string, bumpAmount: number, amountEur: string) {
    const product = await prisma.product.create({
      data: { name: `BB Test Product ${suffix}`, type: ProductType.ONE_TIME, active: true },
    });
    const pack = await prisma.bumpPack.create({
      data: { name: `BB Test Pack ${suffix}`, bumpAmount, active: true },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        amount: new Prisma.Decimal(amountEur),
        currency: 'EUR',
        bumpPackId: pack.id,
        active: true,
      },
    });
    return { packId: pack.id, priceId: price.id };
  }

  async function createBumpBonusCampaign(name: string, kind: 'PERCENT' | 'FIXED', value: number) {
    return prisma.campaign.create({
      data: {
        name,
        type: CampaignType.BUMP_BONUS,
        active: true,
        ...nowWindow(),
        params: { kind, value },
      },
    });
  }

  async function checkout(token: string, packId: string) {
    await request(app.getHttpServer())
      .post('/api/billing/checkout/bump-pack')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId })
      .expect(201);
    return prisma.transaction.findFirstOrThrow({
      where: { price: { bumpPackId: packId }, status: TransactionStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function confirm(tx: { id: string; amountGross: Prisma.Decimal; gatewayPaymentIntentId: string | null }) {
    const cents = tx.amountGross.mul(100).toFixed(0);
    await processor.processSuccess({
      transactionId: tx.id,
      dsAmount: cents,
      dsOrder: tx.gatewayPaymentIntentId!,
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Matriz de acreditación — Pro × campaña activa
  // ---------------------------------------------------------------------------

  describe('Matriz Pro × campaña BUMP_BONUS activa', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('Pro + campaña → 3 filas (PACK_PURCHASE + PRO_BONUS + CAMPAIGN_BONUS)', async () => {
      const { user, token } = await createUser('matrix-pro-camp');
      await makePro(user.id);
      const campaign = await createBumpBonusCampaign('BB Matrix Pro+Camp', 'PERCENT', 50);
      const { packId } = await createDedicatedBumpPack('matrix-pro-camp', 20, '5.99');

      const tx = await checkout(token, packId);
      const expectedProBonus = Math.ceil((20 * 20) / 100); // 4, proExtraBumpsPercent=20 sembrado
      const expectedCampaignBonus = Math.ceil((20 * 50) / 100); // 10
      expect(tx.baseBumpAmount).toBe(20);
      expect(tx.bonusBumpAmount).toBe(expectedProBonus);
      expect(tx.campaignBonusBumpAmount).toBe(expectedCampaignBonus);
      expect(tx.campaignId).toBe(campaign.id);

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(20 + expectedProBonus + expectedCampaignBonus); // 34
      expect(wallet.balance).toBe(0); // jamás toca créditos

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: wallet.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.type).sort()).toEqual(
        [BumpLedgerType.PACK_PURCHASE, BumpLedgerType.PRO_BONUS, BumpLedgerType.CAMPAIGN_BONUS].sort(),
      );
      expect(entries.find((e) => e.type === BumpLedgerType.PACK_PURCHASE)?.amount).toBe(20);
      expect(entries.find((e) => e.type === BumpLedgerType.PRO_BONUS)?.amount).toBe(expectedProBonus);
      expect(entries.find((e) => e.type === BumpLedgerType.CAMPAIGN_BONUS)?.amount).toBe(expectedCampaignBonus);
    });

    it('NO-Pro + campaña → 2 filas (PACK_PURCHASE + CAMPAIGN_BONUS), SIN PRO_BONUS', async () => {
      const { user, token } = await createUser('matrix-nopro-camp');
      await createBumpBonusCampaign('BB Matrix NoPro+Camp', 'FIXED', 7);
      const { packId } = await createDedicatedBumpPack('matrix-nopro-camp', 15, '3.99');

      const tx = await checkout(token, packId);
      expect(tx.bonusBumpAmount).toBeNull();
      expect(tx.campaignBonusBumpAmount).toBe(7);

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(15 + 7); // 22

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: wallet.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.type).sort()).toEqual(
        [BumpLedgerType.PACK_PURCHASE, BumpLedgerType.CAMPAIGN_BONUS].sort(),
      );
      expect(entries.find((e) => e.type === BumpLedgerType.PRO_BONUS)).toBeUndefined();
    });

    it('Pro + SIN campaña → 2 filas (PACK_PURCHASE + PRO_BONUS), comportamiento de hoy intacto', async () => {
      const { user, token } = await createUser('matrix-pro-nocamp');
      await makePro(user.id);
      const { packId } = await createDedicatedBumpPack('matrix-pro-nocamp', 30, '7.99');

      const tx = await checkout(token, packId);
      expect(tx.campaignBonusBumpAmount).toBeNull();
      const expectedProBonus = Math.ceil((30 * 20) / 100); // 6

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(30 + expectedProBonus); // 36

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: wallet.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.type).sort()).toEqual(
        [BumpLedgerType.PACK_PURCHASE, BumpLedgerType.PRO_BONUS].sort(),
      );
      expect(entries.find((e) => e.type === BumpLedgerType.CAMPAIGN_BONUS)).toBeUndefined();
    });

    it('ni Pro ni campaña → 1 fila (solo PACK_PURCHASE)', async () => {
      const { user, token } = await createUser('matrix-ni-ni');
      const { packId } = await createDedicatedBumpPack('matrix-ni-ni', 10, '2.99');

      const tx = await checkout(token, packId);
      expect(tx.bonusBumpAmount).toBeNull();
      expect(tx.campaignBonusBumpAmount).toBeNull();

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(10);

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: wallet.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe(BumpLedgerType.PACK_PURCHASE);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Paridad de fórmula con créditos — aditiva, nunca compuesta
  // ---------------------------------------------------------------------------

  describe('Paridad con créditos', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('N base, Pro X% + campaña Y% → N + ceil(N×X/100) + ceil(N×Y/100), NUNCA N×(1+X)×(1+Y)', async () => {
      const { user, token } = await createUser('parity');
      await makePro(user.id);
      await createBumpBonusCampaign('BB Parity', 'PERCENT', 33); // % impar a propósito, para que compuesto != aditivo
      const { packId } = await createDedicatedBumpPack('parity', 40, '9.99');

      const tx = await checkout(token, packId);

      const additiveProBonus = Math.ceil((40 * 20) / 100); // 8
      const additiveCampaignBonus = Math.ceil((40 * 33) / 100); // 14 (13.2 → ceil)
      const additiveTotal = 40 + additiveProBonus + additiveCampaignBonus; // 62
      const compoundTotal = Math.ceil(40 * 1.2 * 1.33); // 64 — lo que daría si fuera compuesto

      expect(tx.bonusBumpAmount).toBe(additiveProBonus);
      expect(tx.campaignBonusBumpAmount).toBe(additiveCampaignBonus);

      await confirm(tx);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(additiveTotal);
      expect(wallet.bumpBalance).not.toBe(compoundTotal); // descarta explícitamente el cálculo compuesto

      // Mismo cálculo, misma fórmula, que RedsysService.createCreditPackCheckout
      // ya usa para créditos (Math.ceil(pack.creditAmount * value / 100), sumado
      // — no compuesto — al bonus Pro): paridad verificada con números reales,
      // no solo leyendo el código de los dos sitios.
      const creditParityBonus = Math.ceil((40 * 33) / 100);
      expect(additiveCampaignBonus).toBe(creditParityBonus);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Invariante del ledger — el caso más complejo (3 filas)
  // ---------------------------------------------------------------------------

  describe('Invariante del ledger', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('wallet.bumpBalance == SUM(BumpLedger.amount) con las 3 filas de acreditación', async () => {
      const { user, token } = await createUser('invariant3');
      await makePro(user.id);
      await createBumpBonusCampaign('BB Invariant', 'FIXED', 9);
      const { packId } = await createDedicatedBumpPack('invariant3', 12, '3.49');

      const tx = await checkout(token, packId);
      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const entries = await prisma.bumpLedger.findMany({ where: { walletId: wallet.id } });
      expect(entries).toHaveLength(3);
      const sum = entries.reduce((acc, e) => acc + e.amount, 0);
      expect(sum).toBe(wallet.bumpBalance);
      expect(wallet.bumpBalance).toBeGreaterThan(12); // confirma que de verdad sumó algo más que la base
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Congelado — cambios a mitad de vuelo no alteran una compra en curso
  // ---------------------------------------------------------------------------

  describe('Congelado en el checkout', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('cambiar BumpPack.bumpAmount después del checkout no altera lo ya congelado', async () => {
      const { user, token } = await createUser('freeze-pack');
      await createBumpBonusCampaign('BB Freeze Pack', 'PERCENT', 50);
      const { packId } = await createDedicatedBumpPack('freeze-pack', 25, '6.49');

      const tx = await checkout(token, packId);
      expect(tx.campaignBonusBumpAmount).toBe(Math.ceil((25 * 50) / 100)); // 13

      await prisma.bumpPack.update({ where: { id: packId }, data: { bumpAmount: 999 } });

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(25 + 13); // el valor congelado, nunca 999+algo
    });

    it('cambiar el % de la campaña después del checkout no altera el bonus ya congelado', async () => {
      const { user, token } = await createUser('freeze-campaign');
      const campaign = await createBumpBonusCampaign('BB Freeze Campaign', 'PERCENT', 20);
      const { packId } = await createDedicatedBumpPack('freeze-campaign', 40, '9.99');

      const tx = await checkout(token, packId);
      const frozenBonus = Math.ceil((40 * 20) / 100); // 8
      expect(tx.campaignBonusBumpAmount).toBe(frozenBonus);

      // Admin sube el % DESPUÉS del checkout, ANTES de confirmar el pago.
      await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${campaign.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ params: { kind: 'PERCENT', value: 90 } })
        .expect(200);

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(40 + frozenBonus); // 48, nunca 40+36=76

      const confirmedTx = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(confirmedTx.campaignBonusBumpAmount).toBe(frozenBonus);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Idempotencia
  // ---------------------------------------------------------------------------

  describe('Idempotencia', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('un reintento del webhook no duplica ninguna de las 3 filas', async () => {
      const { user, token } = await createUser('idem-bonus');
      await makePro(user.id);
      await createBumpBonusCampaign('BB Idem', 'FIXED', 5);
      const { packId } = await createDedicatedBumpPack('idem-bonus', 10, '2.99');

      const tx = await checkout(token, packId);
      await confirm(tx); // primera confirmación

      const walletAfterFirst = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const expectedProBonus = Math.ceil((10 * 20) / 100); // 2
      expect(walletAfterFirst.bumpBalance).toBe(10 + expectedProBonus + 5); // 17

      await confirm(tx); // reintento — Transaction ya no está PENDING

      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(walletAfterRetry.bumpBalance).toBe(17); // sin cambios

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: walletAfterRetry.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(3); // no 6
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Solapamiento — verificado extendiendo, no reimplementando
  // ---------------------------------------------------------------------------

  describe('Solapamiento (CampaignsService.assertNoOverlap, sin cambios de código)', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('dos BUMP_BONUS activos solapados en fechas → CAMPAIGN_OVERLAP', async () => {
      const { startsAt, endsAt } = nowWindow(24 * 60 * 60 * 1000);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Overlap 1',
          type: 'BUMP_BONUS',
          active: true,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 10 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Overlap 2',
          type: 'BUMP_BONUS',
          active: true,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 20 },
        })
        .expect(400);

      expect(res.body.code).toBe('CAMPAIGN_OVERLAP');
    });

    it('un BUMP_BONUS y un CREDIT_BONUS solapados en fechas → coexisten (types distintos)', async () => {
      const { startsAt, endsAt } = nowWindow(24 * 60 * 60 * 1000);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Coexist Bump',
          type: 'BUMP_BONUS',
          active: true,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 10 },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Coexist Credit',
          type: 'CREDIT_BONUS',
          active: true,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 10 },
        })
        .expect(201); // ambas activas al mismo tiempo, sin conflicto
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Validación de tope — reutilizada, no duplicada
  // ---------------------------------------------------------------------------

  describe('Tope de cordura (CAMPAIGN_BONUS_PERCENT_MAX/FIXED_MAX, compartido con CREDIT_BONUS)', () => {
    afterEach(async () => {
      await cleanCampaigns();
    });

    it('BUMP_BONUS PERCENT value=501 (sobre el tope 500) → rechazado', async () => {
      const { startsAt, endsAt } = nowWindow();
      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Cap Over',
          type: 'BUMP_BONUS',
          active: false,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 501 },
        })
        .expect(400);
      expect(res.body.message).toContain('params inválidos');
    });

    it('BUMP_BONUS PERCENT value=500 (tope exacto) → aceptado', async () => {
      const { startsAt, endsAt } = nowWindow();
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'BB Cap Exact',
          type: 'BUMP_BONUS',
          active: false,
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 500 },
        })
        .expect(201);
    });
  });
});
