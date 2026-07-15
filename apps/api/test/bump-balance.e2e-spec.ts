/**
 * Monetización ráfaga 2 — saldo de bumps (moneda separada, gratuita e
 * intransferible), pack de bumps (Opción B) y cupones de bump.
 *
 * Verifica, con el mismo rigor que el sistema de créditos (ejerciendo, no
 * declarando):
 *   - Atomicidad del débito de bumpBalance y del canje de cupón BUMP, en
 *     $transaction — mismo patrón UPDATE ... WHERE condicional que balance.
 *   - Idempotencia: un reintento de bump (bloqueado por el cooldown existente)
 *     no debita dos veces; canjear el mismo cupón BUMP dos veces no duplica
 *     el crédito.
 *   - EL TEST QUE IMPORTA: prioridad de consumo — con bumpBalance disponible,
 *     un bump SIEMPRE lo gasta antes que los créditos, y paidWith en la
 *     respuesta refleja correctamente cuál se usó en cada caso.
 *   - Histórico SIN AMBIGÜEDAD: un mismo listing bumpeado dos veces (una vía
 *     cada moneda) deja una fila localizable por referenceId en el ledger
 *     correspondiente — no hace falta adivinar por cercanía a bumpedAt.
 *   - Pack de bumps (Opción B): es un CreditPack normal por dentro — un Pro
 *     que lo compra recibe el mismo +20% que cualquier pack; el "≈N bumps"
 *     del catálogo se recalcula en vivo si bumpCreditCost cambia.
 */

import { INestApplication } from '@nestjs/common';
import {
  BumpLedgerType,
  CreditLedgerType,
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

describe('Monetización ráfaga 2 — saldo de bumps (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let categoryId: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(RedsysProcessor);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

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
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createUser(suffix: string) {
    const email = `bb-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `BB ${suffix}`,
        slug: `bb-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return { user, token: login.body.accessToken as string };
  }

  async function createActiveListing(userId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `BB listing ${suffix}`,
        slug: `bb-listing-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'e2e listing',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: userId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  async function grantBumpBalance(userId: string, amount: number) {
    await prisma.wallet.upsert({
      where: { userId },
      create: { userId, bumpBalance: amount },
      update: { bumpBalance: amount },
    });
  }

  async function grantCredits(userId: string, amount: number) {
    await prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: amount },
      update: { balance: amount },
    });
  }

  async function getWalletRow(userId: string) {
    return prisma.wallet.findUniqueOrThrow({ where: { userId } });
  }

  function bump(token: string, listingId: string) {
    return request(app.getHttpServer())
      .post(`/api/listings/${listingId}/bump`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** Rebaja bumpedAt para simular que el cooldown de 1h ya pasó (setup de test, no app). */
  async function clearCooldown(listingId: string) {
    await prisma.listing.update({
      where: { id: listingId },
      data: { bumpedAt: new Date(Date.now() - 2 * 3600 * 1000) },
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Atomicidad del débito de bumpBalance
  // ---------------------------------------------------------------------------

  describe('Atomicidad del débito de bumpBalance', () => {
    it('CONCURRENCIA — dos bumps simultáneos (listings distintos) con bumpBalance=1 compartido: exactamente UNO consume el bump gratis, el otro cae a créditos, bumpBalance nunca negativo', async () => {
      const { user, token } = await createUser('atomic-race');
      await grantBumpBalance(user.id, 1);
      await grantCredits(user.id, 500);

      const listingA = await createActiveListing(user.id, 'atomic-race-A');
      const listingB = await createActiveListing(user.id, 'atomic-race-B');

      const [resA, resB] = await Promise.all([bump(token, listingA.id), bump(token, listingB.id)]);

      const paidWiths = [resA.body.paidWith, resB.body.paidWith].sort();
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(paidWiths).toEqual(['BUMP_BALANCE', 'CREDITS']);

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(0); // nunca negativo, exactamente consumido
      expect(wallet.balance).toBe(500 - 5); // el otro bump pagó con créditos (coste por defecto 5)

      // Exactamente una fila en cada ledger, cada una con su propio listing por referencia.
      const bumpDebits = await prisma.bumpLedger.count({
        where: { type: BumpLedgerType.BUMP_DEBIT, referenceType: 'Listing', walletId: wallet.id },
      });
      const creditDebits = await prisma.creditLedger.count({
        where: {
          type: CreditLedgerType.BUMP_DEBIT,
          referenceType: 'Listing',
          walletId: wallet.id,
        },
      });
      expect(bumpDebits).toBe(1);
      expect(creditDebits).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotencia
  // ---------------------------------------------------------------------------

  describe('Idempotencia', () => {
    it('reintento inmediato del mismo bump (cooldown activo) no debita ninguna moneda dos veces', async () => {
      const { user, token } = await createUser('idem-bump');
      await grantBumpBalance(user.id, 3);
      const listing = await createActiveListing(user.id, 'idem-bump');

      const first = await bump(token, listing.id).expect(200);
      expect(first.body.paidWith).toBe('BUMP_BALANCE');

      // Reintento inmediato — mismo patrón que un doble-click o un retry de red.
      const retry = await bump(token, listing.id);
      expect(retry.status).toBe(429); // TOO_MANY_REQUESTS (cooldown), no un segundo débito

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(2); // solo el primer bump consumió saldo

      const debits = await prisma.bumpLedger.count({
        where: { walletId: wallet.id, type: BumpLedgerType.BUMP_DEBIT },
      });
      expect(debits).toBe(1);
    });

    it('canjear el mismo cupón BUMP dos veces → segunda vez rechazada, bumpBalance no se duplica', async () => {
      const { user, token } = await createUser('idem-coupon');
      const code = `BUMPCOUPON-IDEM-${Date.now()}`;
      await prisma.coupon.create({
        data: {
          code,
          rewardType: 'BUMP',
          bumpAmount: 5,
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 3600_000),
        },
      });

      const first = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(200);
      expect(first.body.rewardType).toBe('BUMP');
      expect(first.body.bumpAmount).toBe(5);

      const second = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code });
      expect(second.status).toBe(409);
      expect(second.body.code ?? second.body.message?.code).toBe('COUPON_ALREADY_REDEEMED');

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(5); // no 10 — el segundo canje no acreditó nada
    });
  });

  // ---------------------------------------------------------------------------
  // 3. EL TEST QUE IMPORTA — prioridad de consumo
  // ---------------------------------------------------------------------------

  describe('Prioridad de consumo: bumpBalance ANTES que créditos', () => {
    it('con bumpBalance>0 Y créditos>0 → gasta bumpBalance, créditos INTACTOS, paidWith=BUMP_BALANCE, cost=0', async () => {
      const { user, token } = await createUser('priority-both');
      await grantBumpBalance(user.id, 2);
      await grantCredits(user.id, 100);
      const listing = await createActiveListing(user.id, 'priority-both');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('BUMP_BALANCE');
      expect(res.body.cost).toBe(0);

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(1); // consumió 1
      expect(wallet.balance).toBe(100); // créditos NUNCA tocados
    });

    it('con bumpBalance=0 → gasta créditos, paidWith=CREDITS, cost=bumpCreditCost', async () => {
      const { user, token } = await createUser('priority-credits-only');
      await grantCredits(user.id, 100);
      const listing = await createActiveListing(user.id, 'priority-credits-only');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('CREDITS');
      expect(res.body.cost).toBe(5); // bumpCreditCost por defecto sembrado

      const wallet = await getWalletRow(user.id);
      expect(wallet.balance).toBe(95);
    });

    it('el saldo de bumps se agota tras un uso: el SIGUIENTE bump (otro listing) ya usa créditos', async () => {
      const { user, token } = await createUser('priority-exhaust');
      await grantBumpBalance(user.id, 1);
      await grantCredits(user.id, 100);

      const listing1 = await createActiveListing(user.id, 'priority-exhaust-1');
      const listing2 = await createActiveListing(user.id, 'priority-exhaust-2');

      const res1 = await bump(token, listing1.id).expect(200);
      expect(res1.body.paidWith).toBe('BUMP_BALANCE');

      const res2 = await bump(token, listing2.id).expect(200);
      expect(res2.body.paidWith).toBe('CREDITS');
      expect(res2.body.cost).toBe(5);

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(0);
      expect(wallet.balance).toBe(95);
    });

    it('sin bumpBalance ni créditos suficientes → 402, ninguna moneda tocada', async () => {
      const { user, token } = await createUser('priority-insufficient');
      await grantCredits(user.id, 2); // menos que bumpCreditCost=5
      const listing = await createActiveListing(user.id, 'priority-insufficient');

      await bump(token, listing.id).expect(402);

      const wallet = await getWalletRow(user.id);
      expect(wallet.balance).toBe(2);
      expect(wallet.bumpBalance).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Histórico SIN AMBIGÜEDAD — consultable por referencia, no por tiempo
  // ---------------------------------------------------------------------------

  describe('Histórico sin ambigüedad (corrección pedida)', () => {
    it('un MISMO listing bumpeado dos veces (una con saldo, otra con créditos) deja exactamente una fila localizable en cada ledger, por referenceId — sin adivinar por cercanía a bumpedAt', async () => {
      const { user, token } = await createUser('history-same-listing');
      await grantBumpBalance(user.id, 1);
      await grantCredits(user.id, 100);
      const listing = await createActiveListing(user.id, 'history-same-listing');

      // Primer bump: paga con saldo.
      const first = await bump(token, listing.id).expect(200);
      expect(first.body.paidWith).toBe('BUMP_BALANCE');

      // Cooldown fuera de camino (setup de test) para poder bumpear el MISMO listing otra vez.
      await clearCooldown(listing.id);

      // Segundo bump: ya sin saldo, paga con créditos.
      const second = await bump(token, listing.id).expect(200);
      expect(second.body.paidWith).toBe('CREDITS');

      // La consulta correcta: filtrar CADA ledger por referenceType='Listing' +
      // referenceId=listing.id — sin mirar bumpedAt (que solo guarda el último).
      const bumpLedgerRows = await prisma.bumpLedger.findMany({
        where: { referenceType: 'Listing', referenceId: listing.id },
        orderBy: { createdAt: 'asc' },
      });
      const creditLedgerRows = await prisma.creditLedger.findMany({
        where: { referenceType: 'Listing', referenceId: listing.id, type: CreditLedgerType.BUMP_DEBIT },
        orderBy: { createdAt: 'asc' },
      });

      expect(bumpLedgerRows).toHaveLength(1);
      expect(bumpLedgerRows[0].amount).toBe(-1);
      expect(bumpLedgerRows[0].type).toBe(BumpLedgerType.BUMP_DEBIT);

      expect(creditLedgerRows).toHaveLength(1);
      expect(creditLedgerRows[0].amount).toBe(-5);

      // Sin ambigüedad temporal: el bumpLedger es estrictamente anterior al
      // creditLedger (primer y segundo bump respectivamente), pero la prueba
      // que de verdad importa es que CADA fila es identificable por sí sola
      // vía referenceId, no por su posición relativa a bumpedAt (que ahora
      // solo refleja el segundo bump, no el primero).
      expect(bumpLedgerRows[0].createdAt.getTime()).toBeLessThan(
        creditLedgerRows[0].createdAt.getTime(),
      );
      expect(listing.bumpedAt).toBeNull(); // estado inicial antes de bumpear
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Cupones de bump — disponibles para cualquiera, molde CREDITS
  // ---------------------------------------------------------------------------

  describe('Cupones de bump (CouponRewardType.BUMP)', () => {
    it('canjear un cupón BUMP acredita bumpBalance + fila BumpLedger COUPON_REDEEM — funciona para un usuario NO-Pro', async () => {
      const { user, token } = await createUser('coupon-nopro');
      const code = `BUMPCOUPON-NOPRO-${Date.now()}`;
      await prisma.coupon.create({
        data: {
          code,
          rewardType: 'BUMP',
          bumpAmount: 7,
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 3600_000),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(200);

      expect(res.body).toEqual({
        rewardType: 'BUMP',
        creditAmount: null,
        featuredDurationDays: null,
        bumpAmount: 7,
      });

      const wallet = await getWalletRow(user.id);
      expect(wallet.bumpBalance).toBe(7);

      const ledger = await prisma.bumpLedger.findFirstOrThrow({ where: { walletId: wallet.id } });
      expect(ledger.type).toBe(BumpLedgerType.COUPON_REDEEM);
      expect(ledger.amount).toBe(7);
      expect(ledger.referenceType).toBe('Coupon');
    });

    it('admin: crear cupón BUMP requiere bumpAmount; creditAmount/featuredDurationDays no permitidos para BUMP', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `BUMPCOUPON-ADMIN-${Date.now()}`,
          rewardType: 'BUMP',
          bumpAmount: 3,
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(201);
      expect(res.body.bumpAmount).toBe(3);
      expect(res.body.creditAmount).toBeNull();
      expect(res.body.featuredDurationDays).toBeNull();

      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `BUMPCOUPON-BADFIELD-${Date.now()}`,
          rewardType: 'BUMP',
          creditAmount: 10, // no debe permitirse en un cupón BUMP
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Pack de bumps (Opción B) — sigue siendo un CreditPack normal
  // ---------------------------------------------------------------------------

  describe('Pack de bumps — Opción B (CreditPack con highlightBumps)', () => {
    let bumpPackId: string;
    let bumpPackPriceId: string;
    const BUMP_PACK_CREDITS = 60;
    let originalBumpCreditCost: number;

    beforeAll(async () => {
      // Dedicado a este describe (no el "Pack de bumps" sembrado): evita
      // interferir con otros specs que puedan compartir BD en la misma pasada.
      const product = await prisma.product.create({
        data: { name: 'BB Bump Pack Test Product', type: ProductType.ONE_TIME, active: true },
      });
      const pack = await prisma.creditPack.create({
        data: {
          name: 'BB Bump Pack Test',
          creditAmount: BUMP_PACK_CREDITS,
          active: true,
          highlightBumps: true,
        },
      });
      const price = await prisma.price.create({
        data: { productId: product.id, amount: 4.99, currency: 'EUR', creditPackId: pack.id, active: true },
      });
      bumpPackId = pack.id;
      bumpPackPriceId = price.id;

      const setting = await prisma.setting.findUniqueOrThrow({ where: { key: 'bumpCreditCost' } });
      originalBumpCreditCost = Number(setting.value);
    });

    afterAll(async () => {
      await prisma.setting.update({
        where: { key: 'bumpCreditCost' },
        data: { value: originalBumpCreditCost },
      });
    });

    it('un Pro que compra el pack de bumps recibe el mismo +20% de bonus que cualquier pack (Opción B: no es una moneda nueva)', async () => {
      const email = `bb-pro-buyer-${Date.now()}@example.com`;
      const proUser = await prisma.user.create({
        data: {
          email,
          name: 'BB Pro Buyer',
          slug: `bb-pro-buyer-${Date.now()}`,
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Test1234!' });
      const token = login.body.accessToken as string;

      const proPrice = await prisma.price.findFirstOrThrow({
        where: { product: { type: ProductType.RECURRING } },
      });
      const subscription = await prisma.subscription.create({
        data: {
          userId: proUser.id,
          priceId: proPrice.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
          gatewaySubscriptionId: `sub_bb_${proUser.id}`,
        },
      });
      await prisma.entitlement.create({
        data: {
          userId: proUser.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          subscriptionId: subscription.id,
          priceId: proPrice.id,
          expiresAt: subscription.currentPeriodEnd,
        },
      });

      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${token}`)
        .send({ packId: bumpPackId })
        .expect(201);

      const tx = await prisma.transaction.findFirstOrThrow({
        where: { userId: proUser.id, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      const expectedBonus = Math.ceil((BUMP_PACK_CREDITS * 20) / 100); // 12, con el 20% sembrado
      expect(tx.bonusCreditAmount).toBe(expectedBonus);

      const cents = tx.amountGross.mul(100).toFixed(0);
      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: cents,
        dsOrder: tx.gatewayPaymentIntentId!,
      });

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: proUser.id } });
      expect(wallet.balance).toBe(BUMP_PACK_CREDITS + expectedBonus); // 72 — el pack acredita CRÉDITOS, no bumpBalance
      expect(wallet.bumpBalance).toBe(0); // Opción B: comprar el pack NUNCA toca la moneda de bumps
    });

    it('el catálogo recalcula "≈N bumps" EN VIVO si bumpCreditCost cambia — nunca queda un texto fijo desincronizado', async () => {
      await prisma.setting.update({ where: { key: 'bumpCreditCost' }, data: { value: 5 } });
      const before = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      const priceBefore = findPriceInCatalog(before.body, bumpPackPriceId);
      expect(priceBefore.bumpEquivalent).toBe(Math.floor(BUMP_PACK_CREDITS / 5)); // 12

      await request(app.getHttpServer())
        .patch('/api/admin/settings/bumpCreditCost')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 10 })
        .expect(200);

      const after = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      const priceAfter = findPriceInCatalog(after.body, bumpPackPriceId);
      expect(priceAfter.bumpEquivalent).toBe(Math.floor(BUMP_PACK_CREDITS / 10)); // 6 — recalculado, nada guardado

      // Un pack SIN highlightBumps (p. ej. "Pack Estándar" sembrado) nunca expone bumpEquivalent.
      const standardPrice = after.body.products
        .flatMap((p: { prices: unknown[] }) => p.prices)
        .find((pr: { packName?: string }) => pr.packName === 'Pack Estándar');
      expect(standardPrice?.bumpEquivalent).toBeUndefined();
    });

    function findPriceInCatalog(catalogBody: { products: { prices: { priceId: string }[] }[] }, priceId: string) {
      const price = catalogBody.products
        .flatMap((p) => p.prices)
        .find((pr) => pr.priceId === priceId);
      if (!price) throw new Error(`Price ${priceId} not found in catalog response`);
      return price as { bumpEquivalent?: number };
    }
  });
});
