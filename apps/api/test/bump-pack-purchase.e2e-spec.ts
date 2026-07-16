/**
 * Monetización ráfaga 4 — packs de bumps DIRECTOS (BumpPack), con bonus Pro
 * (proExtraBumpsPercent) y la retirada limpia del mecanismo anterior
 * (CreditPack.highlightBumps, Opción B de la ráfaga 2).
 *
 * Verifica, con el mismo rigor que el resto del sistema de monetización
 * (ejerciendo, no declarando):
 *   - La compra por Redsys acredita bumpBalance (base + bonus Pro), atómica,
 *     en $transaction — mismo molde que handlePackPurchase para créditos.
 *   - Idempotencia: un reintento del webhook sobre una Transaction ya
 *     SUCCEEDED no acredita dos veces (capa 2 ya existente, sin cambios).
 *   - CONGELADO: base y bonus se fijan en el checkout (Transaction.
 *     baseBumpAmount/bonusBumpAmount) — cambiar el pack o el % de bonus a
 *     mitad de vuelo NO altera lo que esa compra concreta otorga ("el test
 *     que importa", mismo patrón que admin-pricing.e2e-spec.ts).
 *   - El invariante wallet.bumpBalance == SUM(BumpLedger.amount) se mantiene
 *     con las dos filas nuevas (PACK_PURCHASE + PRO_BONUS, ambas con amount
 *     real — a diferencia de PRO_QUOTA, que siempre es 0).
 *   - Retirada: el CreditPack con highlightBumps desactivado en la ráfaga NO
 *     aparece en el catálogo ni es comprable; las Transaction históricas que
 *     lo referencian siguen íntegras.
 *   - Un no-Pro no recibe bonus (bonusBumpAmount queda null).
 */

import { INestApplication } from '@nestjs/common';
import {
  BumpLedgerType,
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

describe('Monetización ráfaga 4 — packs de bumps directos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(RedsysProcessor);

    const admin = await prisma.user.create({
      data: {
        email: 'bpp-admin@example.com',
        name: 'BPP Admin',
        slug: 'bpp-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'bpp-admin@example.com', password: 'Test1234!' });
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
    const email = `bpp-${suffix}-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `BPP ${suffix}`,
        slug: `bpp-${suffix}-${Date.now()}`,
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
        gatewaySubscriptionId: `sub_bpp_${userId}_${Date.now()}`,
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

  /** Crea un BumpPack + Product + Price DEDICADOS a este spec — evita mutar
   * los 3 packs sembrados (no tocar el catálogo compartido entre specs). */
  async function createDedicatedBumpPack(suffix: string, bumpAmount: number, amountEur: string) {
    const product = await prisma.product.create({
      data: { name: `BPP Test Product ${suffix}`, type: ProductType.ONE_TIME, active: true },
    });
    const pack = await prisma.bumpPack.create({
      data: { name: `BPP Test Pack ${suffix}`, bumpAmount, active: true },
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
  // 1. Compra atómica: base + bonus Pro
  // ---------------------------------------------------------------------------

  describe('Compra por Redsys — acredita bumpBalance atómicamente', () => {
    it('un Pro que compra un pack de bumps recibe base + bonus (proExtraBumpsPercent), en BumpBalance — NUNCA en balance de créditos', async () => {
      const { user, token } = await createUser('pro-buyer');
      await makePro(user.id);
      const { packId } = await createDedicatedBumpPack('pro', 20, '5.99');

      const tx = await checkout(token, packId);
      const expectedBonus = Math.ceil((20 * 20) / 100); // 4, con proExtraBumpsPercent=20 sembrado
      expect(tx.baseBumpAmount).toBe(20);
      expect(tx.bonusBumpAmount).toBe(expectedBonus);

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(20 + expectedBonus); // 24
      expect(wallet.balance).toBe(0); // JAMÁS toca créditos

      const confirmed = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(confirmed.status).toBe(TransactionStatus.SUCCEEDED);
    });

    it('un NO-Pro que compra un pack de bumps recibe SOLO la base — bonusBumpAmount queda null, sin fila PRO_BONUS', async () => {
      const { user, token } = await createUser('nopro-buyer');
      const { packId } = await createDedicatedBumpPack('nopro', 15, '3.99');

      const tx = await checkout(token, packId);
      expect(tx.baseBumpAmount).toBe(15);
      expect(tx.bonusBumpAmount).toBeNull();

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(15); // sin bonus

      const ledgerEntries = await prisma.bumpLedger.findMany({ where: { walletId: wallet.id } });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0].type).toBe(BumpLedgerType.PACK_PURCHASE);
      expect(ledgerEntries.some((e) => e.type === BumpLedgerType.PRO_BONUS)).toBe(false);
    });

    it('las dos filas del ledger son SEPARADAS (PACK_PURCHASE + PRO_BONUS), no combinadas — permite reportar el coste del bonus Pro', async () => {
      const { user, token } = await createUser('separate-rows');
      await makePro(user.id);
      const { packId } = await createDedicatedBumpPack('separate', 30, '7.99');

      const tx = await checkout(token, packId);
      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: wallet.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(2);

      const purchaseEntry = entries.find((e) => e.type === BumpLedgerType.PACK_PURCHASE);
      const bonusEntry = entries.find((e) => e.type === BumpLedgerType.PRO_BONUS);
      expect(purchaseEntry?.amount).toBe(30);
      expect(bonusEntry?.amount).toBe(Math.ceil((30 * 20) / 100)); // 6
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotencia
  // ---------------------------------------------------------------------------

  describe('Idempotencia', () => {
    it('un reintento del webhook sobre una Transaction ya SUCCEEDED no acredita bumps dos veces', async () => {
      const { user, token } = await createUser('idem');
      const { packId } = await createDedicatedBumpPack('idem', 10, '2.99');

      const tx = await checkout(token, packId);
      await confirm(tx); // primera confirmación — acredita

      const walletAfterFirst = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(walletAfterFirst.bumpBalance).toBe(10);

      await confirm(tx); // reintento — la Transaction ya no está PENDING

      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(walletAfterRetry.bumpBalance).toBe(10); // sin cambios

      const entries = await prisma.bumpLedger.findMany({
        where: { walletId: walletAfterRetry.id, referenceType: 'Transaction', referenceId: tx.id },
      });
      expect(entries).toHaveLength(1); // una sola fila, no dos
    });
  });

  // ---------------------------------------------------------------------------
  // 3. EL TEST QUE IMPORTA — congelado
  // ---------------------------------------------------------------------------

  describe('Congelado en el checkout — cambios a mitad de vuelo no alteran una compra en curso', () => {
    it('cambiar BumpPack.bumpAmount después del checkout no altera lo que esa Transaction ya congeló', async () => {
      const { user, token } = await createUser('freeze-pack');
      const { packId } = await createDedicatedBumpPack('freeze-pack', 25, '6.49');

      const tx = await checkout(token, packId);
      expect(tx.baseBumpAmount).toBe(25);

      // Admin sube la cantidad DESPUÉS del checkout, ANTES de confirmar el pago.
      await request(app.getHttpServer())
        .patch(`/api/admin/billing/bump-packs/${packId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bumpAmount: 999 })
        .expect(200);

      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.bumpBalance).toBe(25); // el valor congelado, nunca 999

      const confirmedTx = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(confirmedTx.baseBumpAmount).toBe(25);
    });

    it('cambiar proExtraBumpsPercent después del checkout no altera el bonus ya congelado', async () => {
      const { user, token } = await createUser('freeze-bonus');
      await makePro(user.id);
      const { packId } = await createDedicatedBumpPack('freeze-bonus', 40, '9.99');

      const tx = await checkout(token, packId);
      const frozenBonus = Math.ceil((40 * 20) / 100); // 8, con el 20% vigente al checkout
      expect(tx.bonusBumpAmount).toBe(frozenBonus);

      // Admin sube el % DESPUÉS del checkout, ANTES de confirmar el pago.
      await request(app.getHttpServer())
        .patch('/api/admin/settings/proExtraBumpsPercent')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 90 })
        .expect(200);

      try {
        await confirm(tx);

        const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        expect(wallet.bumpBalance).toBe(40 + frozenBonus); // 48, nunca 40+36=76

        const confirmedTx = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
        expect(confirmedTx.bonusBumpAmount).toBe(frozenBonus);
      } finally {
        await request(app.getHttpServer())
          .patch('/api/admin/settings/proExtraBumpsPercent')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ value: 20 })
          .expect(200);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Invariante del ledger
  // ---------------------------------------------------------------------------

  describe('Invariante del ledger', () => {
    it('wallet.bumpBalance == SUM(BumpLedger.amount) tras una compra con bonus (PACK_PURCHASE + PRO_BONUS, ambas con amount real)', async () => {
      const { user, token } = await createUser('invariant');
      await makePro(user.id);
      const { packId } = await createDedicatedBumpPack('invariant', 12, '3.49');

      const tx = await checkout(token, packId);
      await confirm(tx);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const entries = await prisma.bumpLedger.findMany({ where: { walletId: wallet.id } });
      const sum = entries.reduce((acc, e) => acc + e.amount, 0);
      expect(sum).toBe(wallet.bumpBalance);
      expect(wallet.bumpBalance).toBeGreaterThan(0); // a diferencia de PRO_QUOTA (amount:0), aquí sí suma
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Retirada limpia del pack anterior (highlightBumps)
  // ---------------------------------------------------------------------------

  describe('Retirada del pack de créditos-con-highlightBumps (Opción B, ráfaga 2)', () => {
    // NOTA sobre el alcance de este describe: el CreditPack real "Pack de
    // bumps" (highlightBumps=true) sembrado en la ráfaga 2 nunca llegó a
    // crearse en esta base de test compartida — seedCreditPacks() se salta
    // por completo si ya hay algún CreditPack (guard "skip if any exist"), y
    // para cuando la ráfaga 2 añadió esa entrada, esta BD de test YA tenía
    // los 3 packs originales sembrados. La migración de datos
    // (20260716090500_deactivate_highlightbumps_pack) SÍ se verificó
    // manualmente contra la BD de dev, donde el pack real existía (pack_active=f,
    // price_active=f tras aplicarla). Lo que estos tests verifican en su lugar
    // — y es lo que de verdad importa hacia delante — es el MECANISMO de
    // retirada: un CreditPack + Price desactivados quedan invisibles e
    // incomprables, y su histórico sigue íntegro. Se simula aquí con un pack
    // dedicado, para no depender de una fila concreta con historia frágil.
    let retiredPackId: string;
    let retiredPriceId: string;
    let historicalTransactionId: string;

    beforeAll(async () => {
      const product = await prisma.product.create({
        data: { name: 'BPP Retired Pack Product', type: ProductType.ONE_TIME, active: true },
      });
      const pack = await prisma.creditPack.create({
        data: { name: 'BPP Retired Pack', creditAmount: 60, active: true },
      });
      const price = await prisma.price.create({
        data: { productId: product.id, amount: 4.99, currency: 'EUR', creditPackId: pack.id, active: true },
      });
      retiredPackId = pack.id;
      retiredPriceId = price.id;

      // Compra histórica ANTES de la retirada — debe seguir íntegra después.
      // (checkout de CRÉDITOS, no de bumps — este describe simula el pack
      // highlightBumps retirado, que acreditaba créditos.)
      const { token } = await createUser('retired-history-buyer');
      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${token}`)
        .send({ packId: retiredPackId })
        .expect(201);
      const tx = await prisma.transaction.findFirstOrThrow({
        where: { priceId: retiredPriceId, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      await confirm(tx);
      historicalTransactionId = tx.id;

      // Retirada: mismo efecto que la migración de datos (desactivar AMBOS,
      // no solo el CreditPack — hallazgo de diseño: getCatalog() filtra por
      // Price.active, nunca por CreditPack.active).
      await prisma.price.update({ where: { id: retiredPriceId }, data: { active: false } });
      await prisma.creditPack.update({ where: { id: retiredPackId }, data: { active: false } });
    });

    it('el CreditPack retirado NO aparece en el catálogo público', async () => {
      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      const allPackNames = res.body.products.flatMap((p: { prices: { packName?: string }[] }) =>
        p.prices.map((pr) => pr.packName),
      );
      expect(allPackNames).not.toContain('BPP Retired Pack');
    });

    it('el CreditPack retirado ya NO es comprable (404 al intentar el checkout)', async () => {
      const { token } = await createUser('retired-buyer');
      await request(app.getHttpServer())
        .post('/api/billing/checkout/credits-pack')
        .set('Authorization', `Bearer ${token}`)
        .send({ packId: retiredPackId })
        .expect(404);
    });

    it('la Transaction histórica que referencia el pack retirado sigue íntegra (no se tocó al desactivar)', async () => {
      const historicalTx = await prisma.transaction.findUniqueOrThrow({
        where: { id: historicalTransactionId },
      });
      expect(historicalTx.status).toBe(TransactionStatus.SUCCEEDED);
      expect(historicalTx.baseCreditAmount).toBe(60);

      // El pack/price desactivados (no borrados) siguen existiendo y son
      // consultables — condición necesaria para que la FK de la Transaction
      // no se rompa.
      const retiredPack = await prisma.creditPack.findUniqueOrThrow({
        where: { id: retiredPackId },
        include: { price: true },
      });
      expect(retiredPack.active).toBe(false);
      expect(retiredPack.price!.active).toBe(false);
    });

    it('los 3 packs de bumps directos (BumpPack) SÍ aparecen en el catálogo, con bumpAmount y sin bumpEquivalent', async () => {
      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      const bumpPrices = res.body.products
        .flatMap((p: { prices: { bumpPackId?: string }[] }) => p.prices)
        .filter((pr: { bumpPackId?: string }) => pr.bumpPackId != null);
      expect(bumpPrices.length).toBeGreaterThanOrEqual(3);
      for (const pr of bumpPrices) {
        expect(pr.bumpAmount).toBeGreaterThan(0);
        expect(pr.bumpEquivalent).toBeUndefined(); // el campo derivado retirado ya no existe
      }
    });
  });
});
