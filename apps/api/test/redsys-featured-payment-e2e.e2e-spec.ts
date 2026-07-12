/**
 * Redsys — camino completo de pago con tarjeta para destacar un anuncio (e2e)
 *
 * Este es el "mayor hueco de verificación" identificado: el camino por el que
 * un usuario paga CON TARJETA (Redsys) nunca se había ejercido de punta a
 * punta. redsys.e2e-spec.ts y billing-rf6.e2e-spec.ts llaman a
 * RedsysProcessor.processSuccess() directamente, saltándose por completo:
 *   - La verificación real de firma HMAC-SHA256 (RedsysWebhookGuard.canActivate)
 *   - El endpoint HTTP POST /webhooks/redsys
 *   - La visibilidad resultante en el índice de búsqueda (boostScore)
 *
 * Este archivo cierra esos huecos usando `serializeAndSignJSONRequest` de la
 * propia librería `redsys-easy` para construir notificaciones firmadas
 * válidas con la misma REDSYS_SECRET_KEY que usa el guard — no es un atajo:
 * el algoritmo de firma es simétrico (Redsys firma requests y notificaciones
 * con el mismo HMAC_SHA256_V1 derivado de Ds_Order), así que esto reproduce
 * exactamente lo que Redsys enviaría, sin necesitar el sandbox real.
 */

import { INestApplication } from '@nestjs/common';
import {
  EntitlementType,
  ListingStatus,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { MeiliSearch } from 'meilisearch';
import { serializeAndSignJSONRequest } from 'redsys-easy';
import { createTestApp } from './helpers/create-app';
import { cleanDb, resetMeili, buildMeiliClient } from './helpers/db';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

describe('Redsys — camino completo de pago con tarjeta para destacar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let processor: RedsysProcessor;
  let sellerToken: string;
  let sellerUserId: string;
  let categoryId: string;
  let featuredPriceId: string;
  let featuredPriceAmount: Prisma.Decimal;
  let featuredDurationDays: number;

  const SECRET_KEY = process.env.REDSYS_SECRET_KEY!;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await resetMeili(meili);

    processor = app.get(RedsysProcessor);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const price = await prisma.price.findFirstOrThrow({
      where: { active: true, durationDays: 7, creditPackId: null },
    });
    featuredPriceId = price.id;
    featuredPriceAmount = price.amount;
    featuredDurationDays = price.durationDays!;

    const user = await prisma.user.create({
      data: {
        email: 'redsys-featured-e2e@example.com',
        name: 'Redsys Featured E2E',
        slug: 'redsys-featured-e2e',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerUserId = user.id;

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'redsys-featured-e2e@example.com', password: 'Test1234!' });
    sellerToken = login.body.accessToken as string;
    if (!sellerToken) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  let listingCounter = 0;

  async function createActiveListing(): Promise<string> {
    listingCounter += 1;
    const listing = await prisma.listing.create({
      data: {
        title: `Redsys featured e2e listing ${listingCounter}`,
        slug: `redsys-featured-e2e-${listingCounter}-${Date.now()}`,
        description: 'Anuncio de prueba para el flujo completo de pago Redsys',
        price: new Prisma.Decimal('99.00'),
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        status: ListingStatus.ACTIVE,
        sellerId: sellerUserId,
        categoryId,
      },
      select: { id: true },
    });
    return listing.id;
  }

  /** Starts a real featured-pay checkout via HTTP and returns the created PENDING Transaction. */
  async function startCheckout(listingId: string) {
    const res = await request(app.getHttpServer())
      .post('/api/billing/checkout/featured-pay')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ priceId: featuredPriceId, listingId })
      .expect(201);

    const tx = await prisma.transaction.findFirstOrThrow({
      where: { listingId, status: TransactionStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    return { tx, redsysFormData: res.body.redsysFormData as Record<string, string> };
  }

  /** Builds a validly-signed Redsys notification using the real signing algorithm (HMAC_SHA256_V1). */
  function buildSignedNotification(opts: { dsOrder: string; dsAmountCents: string; dsResponse: string }) {
    return serializeAndSignJSONRequest(SECRET_KEY, {
      DS_MERCHANT_ORDER: opts.dsOrder,
      Ds_Order: opts.dsOrder,
      Ds_Amount: opts.dsAmountCents,
      Ds_Response: opts.dsResponse,
      Ds_Currency: '978',
      Ds_MerchantCode: '999008881',
    });
  }

  function centsFor(amount: Prisma.Decimal): string {
    return amount.mul(100).toFixed(0);
  }

  async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: T;
    do {
      last = await fn();
      if (predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
    throw new Error(`pollUntil: condition not met within ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
  }

  // ── 1. Camino feliz completo: checkout → webhook firmado → job → entitlement → búsqueda ──

  it('checkout → notificación firmada real → Transaction SUCCEEDED → Entitlement REDSYS → destacado visible en Meilisearch', async () => {
    const listingId = await createActiveListing();
    const { tx } = await startCheckout(listingId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(featuredPriceAmount),
      dsResponse: '0000',
    });

    const res = await request(app.getHttpServer())
      .post('/api/webhooks/redsys')
      .send(notification)
      .expect(200);
    expect(res.body).toEqual({ received: true });

    // BullMQ procesa el job de forma asíncrona — esperar a que la Transaction llegue a SUCCEEDED.
    const finalTx = await pollUntil(
      () => prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
      (t) => t.status !== TransactionStatus.PENDING,
    );
    expect(finalTx.status).toBe(TransactionStatus.SUCCEEDED);

    const entitlement = await prisma.entitlement.findFirst({
      where: { listingId, type: EntitlementType.FEATURED_LISTING },
    });
    expect(entitlement).not.toBeNull();
    expect(entitlement!.origin).toBe('REDSYS');
    expect(entitlement!.transactionId).toBe(tx.id);
    const daysLeft = (entitlement!.expiresAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(featuredDurationDays - 1);
    expect(daysLeft).toBeLessThanOrEqual(featuredDurationDays);

    // El resultado que le importa al usuario: su anuncio aparece destacado en la búsqueda.
    const doc = await pollUntil(
      () => meili.index(process.env.MEILI_INDEX_NAME!).getDocument(listingId) as Promise<{ boostScore: number }>,
      () => true,
    );
    expect(doc.boostScore).toBe(1);
  }, 20_000);

  // ── 2. Firma inválida: rechazada, no concede nada ─────────────────────────

  it('firma inválida → 400, no se concede el entitlement, Transaction sigue PENDING', async () => {
    const listingId = await createActiveListing();
    const { tx } = await startCheckout(listingId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(featuredPriceAmount),
      dsResponse: '0000',
    });
    // Manipular la firma: una notificación forjada por un atacante que no conoce la clave.
    const tampered = { ...notification, Ds_Signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };

    await request(app.getHttpServer())
      .post('/api/webhooks/redsys')
      .send(tampered)
      .expect(400);

    const txAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txAfter.status).toBe(TransactionStatus.PENDING);

    const entitlement = await prisma.entitlement.findFirst({
      where: { listingId, type: EntitlementType.FEATURED_LISTING },
    });
    expect(entitlement).toBeNull();

    // Ni siquiera se registra el GatewayEvent — el guard rechaza antes de esa fase.
    const gatewayEvent = await prisma.gatewayEvent.findUnique({ where: { gatewayEventId: dsOrder } });
    expect(gatewayEvent).toBeNull();
  });

  // ── 3. Notificación duplicada: Redsys puede reintentar su propia notificación ──

  it('notificación duplicada (mismo Ds_Order dos veces) → segunda vez marcada duplicate, no concede dos veces', async () => {
    const listingId = await createActiveListing();
    const { tx } = await startCheckout(listingId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(featuredPriceAmount),
      dsResponse: '0000',
    });

    const first = await request(app.getHttpServer()).post('/api/webhooks/redsys').send(notification).expect(200);
    expect(first.body).toEqual({ received: true });

    const second = await request(app.getHttpServer()).post('/api/webhooks/redsys').send(notification).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    await pollUntil(
      () => prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
      (t) => t.status !== TransactionStatus.PENDING,
    );

    const entitlements = await prisma.entitlement.findMany({
      where: { listingId, type: EntitlementType.FEATURED_LISTING },
    });
    expect(entitlements).toHaveLength(1);
  }, 20_000);

  // ── 4. Pago rechazado por Redsys (tarjeta rechazada / usuario cancela) ────

  it('Ds_Response distinto de 0000 (pago rechazado) → Transaction FAILED, no se concede nada', async () => {
    const listingId = await createActiveListing();
    const { tx } = await startCheckout(listingId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(featuredPriceAmount),
      dsResponse: '0180', // código de denegación Redsys (tarjeta ajena a la operativa)
    });

    const res = await request(app.getHttpServer())
      .post('/api/webhooks/redsys')
      .send(notification)
      .expect(200);
    expect(res.body).toEqual({ received: true });

    // El guard marca FAILED de forma síncrona (no pasa por la cola) — sin esperar.
    const txAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txAfter.status).toBe(TransactionStatus.FAILED);

    const entitlement = await prisma.entitlement.findFirst({
      where: { listingId, type: EntitlementType.FEATURED_LISTING },
    });
    expect(entitlement).toBeNull();
  });

  // ── 5. El escenario predicho: retry tras un fallo transitorio en el paso posterior ──
  //
  // handleFeaturedPay concede el entitlement y marca la Transaction SUCCEEDED
  // ATÓMICAMENTE (grantFeaturedListingAndSucceed — fix aplicado tras confirmar
  // aquí mismo, con este test, un bug real: en la versión anterior de dos pasos,
  // un fallo transitorio justo después de conceder el entitlement dejaba la
  // Transaction PENDING para siempre, porque el propio guard de "ya destacado"
  // rechazaba cualquier reintento posterior. Este test fuerza ese fallo
  // transitorio y comprueba que ahora el retry parte de un estado limpio.

  describe('Retry tras fallo transitorio (justo dentro de la transacción atómica)', () => {
    it('un fallo a mitad de la transacción atómica revierte todo; el reintento de BullMQ concede limpio, una sola vez', async () => {
      const listingId = await createActiveListing();
      const tax = redsysTaxBreakdown(featuredPriceAmount);
      const dsOrder = `20260712RETRY${listingCounter}`;

      const tx = await prisma.transaction.create({
        data: {
          userId: sellerUserId,
          priceId: featuredPriceId,
          listingId,
          ...tax,
          status: TransactionStatus.PENDING,
          gateway: 'REDSYS',
          gatewayPaymentIntentId: dsOrder,
        },
        select: { id: true },
      });
      const cents = centsFor(featuredPriceAmount);

      // `tx` inside $transaction(async (tx) => ...) is a separate transactional
      // proxy, not `prismaService.transaction` — spying on the top-level delegate
      // wouldn't intercept it. Instead, let the REAL transaction run to completion
      // (entitlement created for real, status updated for real, using genuine
      // Postgres statements) and then throw from inside the callback: Prisma
      // reacts to that exactly like it would to a failed statement — the whole
      // transaction rolls back. This exercises real Postgres ROLLBACK semantics,
      // not a mocked approximation of them.
      const prismaService = app.get(PrismaService);
      const realTransaction = prismaService.$transaction.bind(prismaService);
      const transactionSpy = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
          realTransaction(async (tx: unknown) => {
            await fn(tx);
            throw new Error('Simulated transient DB failure right after entitlement grant');
          })) as unknown as typeof prismaService.$transaction);

      try {
        // Intento 1: la transacción atómica (grant + update a SUCCEEDED) falla a
        // mitad de camino → Postgres revierte TODO, incluido el entitlement.
        await expect(
          processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder }),
        ).rejects.toThrow('Simulated transient DB failure');

        const entitlementAfterFirstAttempt = await prisma.entitlement.findFirst({
          where: { listingId, type: EntitlementType.FEATURED_LISTING },
        });
        expect(entitlementAfterFirstAttempt).toBeNull(); // revertido junto con el resto de la tx

        const txAfterFirstAttempt = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
        expect(txAfterFirstAttempt.status).toBe(TransactionStatus.PENDING);

        // Intento 2: BullMQ reintenta el MISMO job. Sin entitlement previo, el
        // guard de "ya destacado" no interfiere y la atómica concede limpio.
        await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder });

        const txAfterRetry = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
        expect(txAfterRetry.status).toBe(TransactionStatus.SUCCEEDED);

        const entitlementCount = await prisma.entitlement.count({
          where: { listingId, type: EntitlementType.FEATURED_LISTING },
        });
        expect(entitlementCount).toBe(1);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });
});
