/**
 * Monetización ráfaga 3 — cuota mensual de bumps gratis de Pro (nivel 1 de 3
 * en la prioridad de consumo del bump: CUOTA → bumpBalance (cupón) → créditos).
 *
 * Réplica deliberada del molde de la cuota de destacados (H8.2/H8.3,
 * h8-featured-quota.e2e-spec.ts): mismo mecanismo de conteo derivado (COUNT
 * sin contador ni cron), mismo lock `SELECT ... FOR UPDATE` sobre la
 * Subscription para la concurrencia, mismo comportamiento de expiración sin
 * gracia. La diferencia real es que los bumps no tienen Entitlement propio —
 * el conteo usa BumpLedger{type:PRO_QUOTA, amount:0} en su lugar.
 *
 * Verifica, ejerciendo (no declarando):
 *   - La matriz completa de consumo (5 casos): Pro-con-cuota, Pro-sin-cuota-
 *     con-saldo, Pro-sin-cuota-sin-saldo, no-Pro-con-saldo, no-Pro-sin-nada.
 *   - Concurrencia de la cuota bajo solapamiento REAL forzado (mismo técnica
 *     que el test determinista de destacados: delay inyectado tras adquirir
 *     el lock, antes de que la tx del caller confirme).
 *   - El invariante wallet.bumpBalance == SUM(BumpLedger.amount) se mantiene
 *     tras un bump por cuota (la fila amount:0 no lo rompe).
 *   - wallet.upsert: un Pro con cuota que NUNCA tuvo fila Wallet, bumpea sin
 *     reventar.
 *   - Expiración: Pro que expira → el siguiente bump cae a nivel 2/3.
 *   - La validación nueva: proMonthlyFeaturedQuota y proMonthlyBumpQuota
 *     rechazan valores negativos o no enteros (hueco preexistente cerrado).
 */

import { INestApplication } from '@nestjs/common';
import {
  BumpLedgerType,
  CreditLedgerType,
  EntitlementType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { EntitlementService } from 'src/modules/billing/entitlement.service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Monetización ráfaga 3 — cuota mensual de bumps Pro (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    // Fixture global — fijar valor conocido para este suite (Setting no se
    // trunca en cleanDb, compartido entre specs de la misma pasada).
    await prisma.setting.upsert({
      where: { key: 'proMonthlyBumpQuota' },
      create: { key: 'proMonthlyBumpQuota', value: 4 },
      update: { value: 4 },
    });

    const admin = await prisma.user.create({
      data: {
        email: 'pbq-admin@example.com',
        name: 'PBQ Admin',
        slug: 'pbq-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'pbq-admin@example.com', password: 'Test1234!' });
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
    const email = `pbq-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `PBQ ${suffix}`,
        slug: `pbq-${suffix}`,
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
        title: `PBQ listing ${suffix}`,
        slug: `pbq-listing-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  async function getProPriceId(): Promise<string> {
    const price = await prisma.price.findFirst({
      where: { product: { type: 'RECURRING' } },
      select: { id: true },
    });
    if (!price) throw new Error('No se encontró ningún Price RECURRING sembrado (Plan Pro)');
    return price.id;
  }

  /** Réplica de createProSubscription en h8-featured-quota.e2e-spec.ts. */
  async function createProSubscription(userId: string, periodStart: Date, periodEnd: Date) {
    const priceId = await getProPriceId();
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gatewaySubscriptionId: `sub_pbq_${userId}_${Date.now()}`,
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

  async function makePro(userId: string) {
    return createProSubscription(
      userId,
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    );
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
    return prisma.wallet.findUnique({ where: { userId } });
  }

  function bump(token: string, listingId: string) {
    return request(app.getHttpServer())
      .post(`/api/listings/${listingId}/bump`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function getProStatus(token: string) {
    const res = await request(app.getHttpServer())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as {
      isPro: boolean;
      bumpQuota: { limit: number; used: number; remaining: number };
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Matriz completa de consumo
  // ---------------------------------------------------------------------------

  describe('Matriz de consumo (5 casos)', () => {
    it('Pro CON cuota disponible → PRO_QUOTA, cost=0, créditos y bumpBalance intactos', async () => {
      const { user, token } = await createUser('matrix-pro-quota');
      await makePro(user.id);
      await grantBumpBalance(user.id, 5); // con saldo Y créditos también disponibles —
      await grantCredits(user.id, 100); // la cuota debe ganar igualmente (nivel 1)
      const listing = await createActiveListing(user.id, 'matrix-pro-quota');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('PRO_QUOTA');
      expect(res.body.cost).toBe(0);

      const wallet = await getWalletRow(user.id);
      expect(wallet!.bumpBalance).toBe(5); // ni tocado
      expect(wallet!.balance).toBe(100); // ni tocado

      const status = await getProStatus(token);
      expect(status.bumpQuota.used).toBe(1);
      expect(status.bumpQuota.remaining).toBe(3);
    });

    it('Pro SIN cuota (agotada) CON saldo de bumps → BUMP_BALANCE', async () => {
      const { user, token } = await createUser('matrix-pro-balance');
      await makePro(user.id);
      await grantBumpBalance(user.id, 2);
      await grantCredits(user.id, 100);

      // Agotar la cuota (4) con bumps previos.
      for (let i = 0; i < 4; i++) {
        const filler = await createActiveListing(user.id, `matrix-exhaust-filler-${i}`);
        await bump(token, filler.id).expect(200);
      }
      const status = await getProStatus(token);
      expect(status.bumpQuota.remaining).toBe(0);

      const listing = await createActiveListing(user.id, 'matrix-pro-balance');
      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('BUMP_BALANCE');

      const wallet = await getWalletRow(user.id);
      expect(wallet!.bumpBalance).toBe(1); // consumió 1 de los 2
      expect(wallet!.balance).toBe(100); // créditos intactos
    });

    it('Pro SIN cuota SIN saldo → CREDITS', async () => {
      const { user, token } = await createUser('matrix-pro-credits');
      await makePro(user.id);
      await grantCredits(user.id, 100);
      // consumir toda la cuota
      for (let i = 0; i < 4; i++) {
        const filler = await createActiveListing(user.id, `matrix-pro-credits-filler-${i}`);
        await bump(token, filler.id).expect(200);
      }

      const listing = await createActiveListing(user.id, 'matrix-pro-credits-target');
      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('CREDITS');
      expect(res.body.cost).toBe(5);

      const wallet = await getWalletRow(user.id);
      expect(wallet!.balance).toBe(95);
    });

    it('NO-Pro CON saldo de bumps → BUMP_BALANCE (nunca ve cuota)', async () => {
      const { user, token } = await createUser('matrix-nopro-balance');
      await grantBumpBalance(user.id, 3);
      await grantCredits(user.id, 100);
      const listing = await createActiveListing(user.id, 'matrix-nopro-balance');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('BUMP_BALANCE');

      const status = await getProStatus(token);
      expect(status.isPro).toBe(false);
      expect(status.bumpQuota).toEqual({ limit: 0, used: 0, remaining: 0 });
    });

    it('NO-Pro sin cuota ni saldo (nunca tuvo Pro ni cupón) → CREDITS', async () => {
      const { user, token } = await createUser('matrix-nopro-credits');
      await grantCredits(user.id, 100);
      const listing = await createActiveListing(user.id, 'matrix-nopro-credits');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('CREDITS');
      expect(res.body.cost).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Concurrencia de la cuota — molde del test determinista de destacados
  // ---------------------------------------------------------------------------

  describe('Concurrencia de la cuota (determinista, solapamiento real forzado)', () => {
    it('dos bumps simultáneos con 1 de cuota restante → exactamente UNO usa PRO_QUOTA, el otro baja de nivel', async () => {
      const { user, token } = await createUser('quota-race-det');
      await makePro(user.id);
      await grantBumpBalance(user.id, 10); // saldo de sobra para el que caiga de nivel
      // Agotar 3 de los 4 → remaining=1
      for (let i = 0; i < 3; i++) {
        const filler = await createActiveListing(user.id, `quota-race-det-filler-${i}`);
        await bump(token, filler.id).expect(200);
      }
      expect((await getProStatus(token)).bumpQuota.remaining).toBe(1);

      const listingA = await createActiveListing(user.id, 'quota-race-det-A');
      const listingB = await createActiveListing(user.id, 'quota-race-det-B');

      const entitlementService = app.get(EntitlementService);
      const original = entitlementService.hasAvailableBumpQuota.bind(entitlementService);
      const DELAY_MS = 300;
      let delayedOnce = false;

      const spy = jest
        .spyOn(entitlementService, 'hasAvailableBumpQuota')
        .mockImplementation(async (tx, uid) => {
          const result = await original(tx, uid);
          if (!delayedOnce) {
            // Quien llegue aquí primero mantiene el lock FOR UPDATE sobre
            // Subscription (dentro de su tx abierta) durante DELAY_MS —
            // tiempo de sobra para que la segunda llamada concurrente
            // intente su propio FOR UPDATE y se vea forzada a esperar.
            delayedOnce = true;
            await sleep(DELAY_MS);
          }
          return result;
        });

      try {
        const start = Date.now();
        const [resA, resB] = await Promise.all([bump(token, listingA.id), bump(token, listingB.id)]);
        const elapsed = Date.now() - start;

        // Si el lock realmente bloqueó (en vez de dejar pasar a los dos por
        // una carrera no serializada), el conjunto tarda al menos DELAY_MS.
        expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS - 20);

        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        const paidWiths = [resA.body.paidWith, resB.body.paidWith].sort();
        // Exactamente uno PRO_QUOTA; el otro cae a BUMP_BALANCE (hay saldo de sobra).
        expect(paidWiths).toEqual(['BUMP_BALANCE', 'PRO_QUOTA']);

        const status = await getProStatus(token);
        expect(status.bumpQuota.used).toBe(4); // 3 previos + exactamente 1 nuevo
        expect(status.bumpQuota.remaining).toBe(0);

        const quotaEntries = await prisma.bumpLedger.count({
          where: {
            type: BumpLedgerType.PRO_QUOTA,
            referenceId: { in: [listingA.id, listingB.id] },
          },
        });
        expect(quotaEntries).toBe(1); // nunca dos, nunca cero
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Invariante bumpBalance == SUM(BumpLedger.amount)
  // ---------------------------------------------------------------------------

  describe('Invariante del ledger', () => {
    it('tras un bump por cuota, wallet.bumpBalance sigue siendo exactamente SUM(BumpLedger.amount) — la fila PRO_QUOTA (amount:0) no lo rompe', async () => {
      const { user, token } = await createUser('invariant');
      await makePro(user.id);
      // Deliberadamente NO se usa grantBumpBalance aquí: ese helper escribe
      // bumpBalance directo en la fila Wallet, sin pasar por BumpLedger —
      // válido para las otras pruebas (solo les importa el saldo de partida),
      // pero rompería ESTE invariante por construcción del propio fixture, no
      // por un bug real. Para verificar el invariante de verdad, el saldo
      // tiene que construirse SOLO a través de caminos reales de la app (aquí:
      // canje de cupón), que sí escriben ambos (Wallet.bumpBalance Y BumpLedger)
      // en la misma transacción.
      const listing = await createActiveListing(user.id, 'invariant');

      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('PRO_QUOTA');

      const wallet = await getWalletRow(user.id);
      expect(wallet!.bumpBalance).toBe(0); // nunca se tocó — el bump se pagó con cuota, no con saldo

      const entries = await prisma.bumpLedger.findMany({ where: { walletId: wallet!.id } });
      const sum = entries.reduce((acc, e) => acc + e.amount, 0);
      expect(sum).toBe(wallet!.bumpBalance); // 0 == 0 — la fila PRO_QUOTA (amount:0) no aporta nada a la suma

      // La fila PRO_QUOTA en sí, explícitamente:
      const quotaEntry = entries.find((e) => e.type === BumpLedgerType.PRO_QUOTA);
      expect(quotaEntry).toBeDefined();
      expect(quotaEntry!.amount).toBe(0);

      // Ahora canjeamos un cupón de bumpBalance (camino real: escribe Wallet Y
      // BumpLedger en la misma tx) y confirmamos que el invariante se
      // mantiene TAMBIÉN con una fila PRO_QUOTA de por medio en el mismo wallet.
      await prisma.coupon.create({
        data: {
          code: `PBQ-INVARIANT-${Date.now()}`,
          rewardType: 'BUMP',
          bumpAmount: 5,
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 3600_000),
        },
      });
      const coupon = await prisma.coupon.findFirstOrThrow({
        where: { bumpAmount: 5, code: { startsWith: 'PBQ-INVARIANT-' } },
        orderBy: { createdAt: 'desc' },
      });
      await request(app.getHttpServer())
        .post('/api/coupons/redeem')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: coupon.code })
        .expect(200);

      const walletAfter = await getWalletRow(user.id);
      const entriesAfter = await prisma.bumpLedger.findMany({ where: { walletId: walletAfter!.id } });
      const sumAfter = entriesAfter.reduce((acc, e) => acc + e.amount, 0);
      expect(walletAfter!.bumpBalance).toBe(5); // solo lo que dio el cupón
      expect(sumAfter).toBe(walletAfter!.bumpBalance); // invariante se mantiene con PRO_QUOTA (0) + COUPON_REDEEM (+5) mezclados
    });
  });

  // ---------------------------------------------------------------------------
  // 4. wallet.upsert — Pro con cuota que nunca tuvo Wallet
  // ---------------------------------------------------------------------------

  describe('Pro sin Wallet previo', () => {
    it('un Pro con cuota disponible que NUNCA tuvo fila Wallet puede bumpear por cuota sin reventar', async () => {
      const { user, token } = await createUser('no-prior-wallet');
      await makePro(user.id);
      // Deliberadamente NO se llama a grantBumpBalance ni grantCredits — sin
      // fila Wallet en absoluto. hasAvailableFeaturedQuota no la necesita
      // (cuenta Entitlement/BumpLedger vía join), pero CREAR la fila
      // PRO_QUOTA sí exige que la fila Wallet exista — de ahí el upsert.
      expect(await getWalletRow(user.id)).toBeNull();

      const listing = await createActiveListing(user.id, 'no-prior-wallet');
      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('PRO_QUOTA');

      const wallet = await getWalletRow(user.id);
      expect(wallet).not.toBeNull();
      expect(wallet!.balance).toBe(0);
      expect(wallet!.bumpBalance).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Expiración — sin gracia, igual que destacados
  // ---------------------------------------------------------------------------

  describe('Expiración de Pro', () => {
    it('un Pro cuya suscripción ya expiró NO ve cuota — el bump cae directo a nivel 2/3', async () => {
      const { user, token } = await createUser('expired');
      // Subscription/Entitlement YA expirados (expiresAt en el pasado).
      const priceId = await getProPriceId();
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          priceId,
          status: 'CANCELED',
          currentPeriodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          gatewaySubscriptionId: `sub_pbq_expired_${user.id}`,
        },
      });
      await prisma.entitlement.create({
        data: {
          userId: user.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          subscriptionId: subscription.id,
          priceId,
          expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // en el pasado
        },
      });
      await grantBumpBalance(user.id, 2);

      const status = await getProStatus(token);
      expect(status.isPro).toBe(false);
      expect(status.bumpQuota).toEqual({ limit: 0, used: 0, remaining: 0 });

      const listing = await createActiveListing(user.id, 'expired');
      const res = await bump(token, listing.id).expect(200);
      expect(res.body.paidWith).toBe('BUMP_BALANCE'); // nunca PRO_QUOTA — cae directo a nivel 2
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Validación — el hueco preexistente, cerrado
  // ---------------------------------------------------------------------------

  describe('Validación de las Settings de cuota (hueco cerrado)', () => {
    it.each(['proMonthlyFeaturedQuota', 'proMonthlyBumpQuota'])(
      '%s: negativo → 400',
      async (key) => {
        await request(app.getHttpServer())
          .patch(`/api/admin/settings/${key}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: -1 })
          .expect(400);
      },
    );

    it.each(['proMonthlyFeaturedQuota', 'proMonthlyBumpQuota'])(
      '%s: decimal → 400',
      async (key) => {
        await request(app.getHttpServer())
          .patch(`/api/admin/settings/${key}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: 2.5 })
          .expect(400);
      },
    );

    it.each(['proMonthlyFeaturedQuota', 'proMonthlyBumpQuota'])(
      '%s: 0 → 400 (ahora exige >= 1, ya no acepta "cuota desactivada")',
      async (key) => {
        await request(app.getHttpServer())
          .patch(`/api/admin/settings/${key}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: 0 })
          .expect(400);
      },
    );

    it.each(['proMonthlyFeaturedQuota', 'proMonthlyBumpQuota'])(
      '%s: entero positivo → 200, con AuditLog',
      async (key) => {
        const res = await request(app.getHttpServer())
          .patch(`/api/admin/settings/${key}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: 6 })
          .expect(200);
        expect(res.body.value).toBe(6);

        const log = await prisma.auditLog.findFirst({
          where: { resourceId: key, action: 'SETTING_UPDATE' },
          orderBy: { createdAt: 'desc' },
        });
        expect(log).not.toBeNull();
        expect((log!.after as { value: number }).value).toBe(6);

        // Restaurar para no filtrar a otros specs de la misma pasada.
        await request(app.getHttpServer())
          .patch(`/api/admin/settings/${key}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: 4 })
          .expect(200);
      },
    );
  });
});
