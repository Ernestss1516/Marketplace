/**
 * Stripe — camino completo de suscripción Pro: checkout + RENOVACIÓN (e2e)
 *
 * Mismo hueco que ya se cerró en Redsys (destacado y pack de créditos), aplicado
 * al tercer y último canal de dinero del proyecto: Stripe. Ningún test existente
 * llama al endpoint HTTP real `POST /webhooks/stripe` — `billing.service.spec.ts`
 * mockea el SDK de Stripe a nivel unitario, y no hay ningún test de
 * `BillingProcessor` en absoluto. La renovación (2ª factura) — el negocio real
 * de una suscripción, no solo la adquisición — nunca se había ejercido.
 *
 * **Cómo se firma un webhook de Stripe sin sandbox real:** el propio SDK de
 * Stripe expone `stripe.webhooks.generateTestHeaderString({ payload, secret })`
 * — construye la cabecera `stripe-signature` real (HMAC-SHA256 sobre
 * `${timestamp}.${payload}`) con la misma `STRIPE_WEBHOOK_SECRET` que usa
 * `StripeWebhookGuard`. Es el equivalente exacto de `serializeAndSignJSONRequest`
 * de `redsys-easy` en el molde de Redsys — firma real, no un mock.
 *
 * **RAW BODY:** la verificación de firma de Stripe es sobre los BYTES exactos
 * del cuerpo. `createTestApp()` no habilitaba `rawBody: true` (a diferencia de
 * `main.ts`) — sin eso, `request.rawBody` nunca llega a `StripeWebhookGuard` y
 * CUALQUIER firma, válida o no, se rechaza con "Missing stripe-signature or
 * body". Corregido en `test/helpers/create-app.ts`. El body se envía como
 * string ya serializado (mismo string que se firmó), con
 * `Content-Type: application/json` — nunca `.send(objeto)`, que Supertest
 * volvería a serializar y desincronizaría los bytes firmados de los enviados.
 */

import { INestApplication } from '@nestjs/common';
import {
  EntitlementType,
  Prisma,
  PrismaClient,
  PriceInterval,
  ProductType,
  SubscriptionStatus,
  TransactionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import Stripe = require('stripe');
import { Job } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { BillingProcessor } from 'src/modules/billing/billing.processor';
import { BILLING_JOB, BillingJobData, STRIPE_EVENTS } from 'src/modules/billing/billing.types';

describe('Stripe — checkout + renovación de suscripción Pro (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: BillingProcessor;
  let stripe: Stripe;
  let priceId: string; // nuestro Price.id interno
  let gatewayPriceId: string; // Stripe Price id sintético

  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
  const ONE_MONTH_SECONDS = 30 * 24 * 60 * 60;
  const AMOUNT_CENTS = 999; // 9,99 €

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(BillingProcessor);
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const product = await prisma.product.create({
      data: { name: 'Plan Pro E2E', type: ProductType.RECURRING },
    });
    gatewayPriceId = `price_e2e_pro_${Date.now()}`;
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        amount: new Prisma.Decimal('9.99'),
        interval: PriceInterval.MONTH,
        intervalCount: 1,
        gatewayPriceId,
      },
      select: { id: true },
    });
    priceId = price.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  let counter = 0;
  // GatewayEvent (Stripe idempotency key) has no FK to User, so cleanDb()
  // never truncates it — leftover rows from a previous local run of this same
  // file would make every webhook look like a duplicate on rerun (200 OK, but
  // never (re-)enqueued). RUN_ID makes every id genuinely unique per run.
  const RUN_ID = Date.now();

  async function createBuyer(): Promise<string> {
    counter += 1;
    const email = `stripe-renewal-e2e-${counter}-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `Stripe Renewal E2E ${counter}`,
        slug: `stripe-renewal-e2e-${counter}-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    return user.id;
  }

  /** Builds an Event body (as the exact JSON string to sign+send) and its real stripe-signature. */
  function signedEvent(eventId: string, type: string, object: Record<string, unknown>) {
    const bodyStr = JSON.stringify({ id: eventId, object: 'event', type, data: { object } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: bodyStr, secret: WEBHOOK_SECRET });
    return { bodyStr, signature };
  }

  function postWebhook(bodyStr: string, signature: string) {
    return request(app.getHttpServer())
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(bodyStr);
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

  function checkoutSessionObject(
    userId: string,
    stripeCustomerId: string,
    gatewaySubscriptionId: string,
    n: string,
  ): Record<string, unknown> {
    return {
      id: `cs_test_e2e_${n}`,
      object: 'checkout.session',
      customer: stripeCustomerId,
      subscription: gatewaySubscriptionId,
      mode: 'subscription',
      metadata: { userId, priceId },
    };
  }

  function invoiceObject(opts: {
    invoiceId: string;
    stripeCustomerId: string;
    gatewaySubscriptionId: string;
    periodStartSec: number;
    periodEndSec: number;
  }): Record<string, unknown> {
    return {
      id: opts.invoiceId,
      object: 'invoice',
      customer: opts.stripeCustomerId,
      amount_paid: AMOUNT_CENTS,
      amount_due: AMOUNT_CENTS,
      lines: {
        data: [
          {
            subscription: opts.gatewaySubscriptionId,
            period: { start: opts.periodStartSec, end: opts.periodEndSec },
            pricing: { price_details: { price: gatewayPriceId } },
          },
        ],
      },
    };
  }

  /** checkout.session.completed → invoice.payment_succeeded (1ª factura), vía HTTP real firmado. */
  async function setupSubscriptionWithFirstInvoice() {
    counter += 1;
    const n = `${counter}_${RUN_ID}`;
    const userId = await createBuyer();
    const stripeCustomerId = `cus_e2e_${n}`;
    const gatewaySubscriptionId = `sub_e2e_${n}`;

    const checkout = signedEvent(
      `evt_e2e_checkout_${n}`,
      STRIPE_EVENTS.CHECKOUT_SESSION_COMPLETED,
      checkoutSessionObject(userId, stripeCustomerId, gatewaySubscriptionId, n),
    );
    await postWebhook(checkout.bodyStr, checkout.signature).expect(200);

    await pollUntil(
      () => prisma.subscription.findUnique({ where: { gatewaySubscriptionId } }),
      (s) => s !== null,
    );

    const periodAStart = Math.floor(Date.now() / 1000);
    const periodAEnd = periodAStart + ONE_MONTH_SECONDS;
    const invoiceAId = `in_e2e_${n}_a`;

    const invA = signedEvent(
      `evt_e2e_invA_${n}`,
      STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED,
      invoiceObject({
        invoiceId: invoiceAId,
        stripeCustomerId,
        gatewaySubscriptionId,
        periodStartSec: periodAStart,
        periodEndSec: periodAEnd,
      }),
    );
    await postWebhook(invA.bodyStr, invA.signature).expect(200);

    await pollUntil(
      () => prisma.transaction.findUnique({ where: { gatewayInvoiceId: invoiceAId } }),
      (t) => t !== null,
    );

    return { n, userId, stripeCustomerId, gatewaySubscriptionId, periodAEnd };
  }

  // ── 1. Camino feliz: la 2ª factura (renovación real) extiende Subscription + Entitlement ──

  it('checkout → 1ª factura → 2ª factura (renovación) → Subscription y Entitlement extendidos, 2 Transactions', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();

    const periodBEnd = periodAEnd + ONE_MONTH_SECONDS;
    const invoiceBId = `in_e2e_${n}_b`;
    const invB = signedEvent(
      `evt_e2e_invB_${n}`,
      STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED,
      invoiceObject({
        invoiceId: invoiceBId,
        stripeCustomerId,
        gatewaySubscriptionId,
        periodStartSec: periodAEnd,
        periodEndSec: periodBEnd,
      }),
    );

    const res = await postWebhook(invB.bodyStr, invB.signature).expect(200);
    expect(res.body).toEqual({ received: true });

    await pollUntil(
      () => prisma.transaction.findUnique({ where: { gatewayInvoiceId: invoiceBId } }),
      (t) => t !== null,
    );

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } });
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
    expect(Math.floor(sub.currentPeriodEnd.getTime() / 1000)).toBe(periodBEnd);

    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { subscriptionId: sub.id, type: EntitlementType.PRO_SUBSCRIPTION },
    });
    expect(Math.floor(entitlement.expiresAt!.getTime() / 1000)).toBe(periodBEnd);

    const transactions = await prisma.transaction.findMany({ where: { subscriptionId: sub.id } });
    expect(transactions).toHaveLength(2);
    expect(transactions.every((t) => t.status === TransactionStatus.SUCCEEDED)).toBe(true);
  }, 20_000);

  // ── 2. Firma inválida en la renovación → 400, no extiende nada ────────────

  it('firma inválida en la renovación → 400, no extiende Subscription/Entitlement, no crea Transaction', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();

    const periodBEnd = periodAEnd + ONE_MONTH_SECONDS;
    const invoiceBId = `in_e2e_${n}_b`;
    const invB = signedEvent(
      `evt_e2e_invB_${n}`,
      STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED,
      invoiceObject({
        invoiceId: invoiceBId,
        stripeCustomerId,
        gatewaySubscriptionId,
        periodStartSec: periodAEnd,
        periodEndSec: periodBEnd,
      }),
    );

    await request(app.getHttpServer())
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000')
      .send(invB.bodyStr)
      .expect(400);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } });
    expect(Math.floor(sub.currentPeriodEnd.getTime() / 1000)).toBe(periodAEnd);

    const txB = await prisma.transaction.findUnique({ where: { gatewayInvoiceId: invoiceBId } });
    expect(txB).toBeNull();

    // Ni siquiera se registra el GatewayEvent — el guard rechaza antes de esa fase.
    const gatewayEvent = await prisma.gatewayEvent.findUnique({ where: { gatewayEventId: `evt_e2e_invB_${n}` } });
    expect(gatewayEvent).toBeNull();
  });

  // ── 3. Evento duplicado (Stripe reintenta el mismo webhook) ───────────────

  it('evento duplicado (mismo id de evento Stripe dos veces) → segunda vez duplicate:true, no duplica la Transaction', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();
    const periodBEnd = periodAEnd + ONE_MONTH_SECONDS;
    const invoiceBId = `in_e2e_${n}_b`;
    const invB = signedEvent(
      `evt_e2e_invB_${n}`,
      STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED,
      invoiceObject({
        invoiceId: invoiceBId,
        stripeCustomerId,
        gatewaySubscriptionId,
        periodStartSec: periodAEnd,
        periodEndSec: periodBEnd,
      }),
    );

    const first = await postWebhook(invB.bodyStr, invB.signature).expect(200);
    expect(first.body).toEqual({ received: true });
    const second = await postWebhook(invB.bodyStr, invB.signature).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    await pollUntil(
      () => prisma.transaction.findUnique({ where: { gatewayInvoiceId: invoiceBId } }),
      (t) => t !== null,
    );

    const transactions = await prisma.transaction.findMany({ where: { gatewayInvoiceId: invoiceBId } });
    expect(transactions).toHaveLength(1);
  }, 20_000);

  // ── 4. Reintento espurio de BullMQ tras la renovación ya procesada ────────

  it('reintento de BullMQ tras la renovación ya procesada → no duplica Transaction ni reextiende de más', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();
    const periodBEnd = periodAEnd + ONE_MONTH_SECONDS;
    const invoiceBId = `in_e2e_${n}_b`;
    const invoiceBObj = invoiceObject({
      invoiceId: invoiceBId,
      stripeCustomerId,
      gatewaySubscriptionId,
      periodStartSec: periodAEnd,
      periodEndSec: periodBEnd,
    });
    const invB = signedEvent(`evt_e2e_invB_${n}`, STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, invoiceBObj);

    await postWebhook(invB.bodyStr, invB.signature).expect(200);
    await pollUntil(
      () => prisma.transaction.findUnique({ where: { gatewayInvoiceId: invoiceBId } }),
      (t) => t !== null,
    );

    // Simula un job de BullMQ redespachado con el mismo payload — el guard ya
    // no lo re-encolaría (GatewayEvent @unique lo bloquea antes), pero esto
    // ejercita la guarda de idempotencia del PROCESSOR en sí, como un worker
    // que reprocesa el mismo job tras un ack fallido.
    await processor.process({
      name: BILLING_JOB.PROCESS_STRIPE_EVENT,
      data: { eventType: STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, payload: invoiceBObj, metadata: {} },
    } as unknown as Job<BillingJobData>);

    const transactions = await prisma.transaction.findMany({ where: { gatewayInvoiceId: invoiceBId } });
    expect(transactions).toHaveLength(1);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } });
    expect(Math.floor(sub.currentPeriodEnd.getTime() / 1000)).toBe(periodBEnd);
  }, 20_000);

  // ── 5. ATOMICIDAD de la renovación ────────────────────────────────────────
  //
  // El E2E encontró que handleInvoiceSucceeded NO envolvía la extensión de
  // Subscription/Entitlement y la escritura de la Transaction en una única
  // $transaction (a diferencia de AMBOS caminos de Redsys) — un fallo
  // transitorio justo antes de crear la Transaction dejaba el entitlement
  // extendido sin Transaction, sin rollback posible. No llegó a duplicar nada
  // en el reintento (cada escritura era un SET/upsert idempotente, no un
  // create+guarda como el bug original del destacado), pero sí dejaba un
  // hueco de contabilidad real. Arreglado envolviendo todo en una sola
  // `prisma.$transaction` (mismo patrón que grantFeaturedListingAndSucceed /
  // handlePackPurchase). Este test verifica el arreglo con el mismo truco que
  // el molde de Redsys: deja correr la transacción real hasta el final y
  // lanza DESDE el callback para forzar un ROLLBACK genuino de Postgres.

  describe('Atomicidad de la renovación', () => {
    it('un fallo a mitad de la transacción atómica revierte TODO (Subscription + Entitlement + Transaction); el reintento de BullMQ extiende limpio, una sola vez', async () => {
      const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();
      const periodBEnd = periodAEnd + ONE_MONTH_SECONDS;
      const invoiceBId = `in_e2e_${n}_b`;
      const invoiceBObj = invoiceObject({
        invoiceId: invoiceBId,
        stripeCustomerId,
        gatewaySubscriptionId,
        periodStartSec: periodAEnd,
        periodEndSec: periodBEnd,
      });

      // `tx` dentro de $transaction(async (tx) => ...) es un proxy transaccional
      // aparte, no `prismaService.transaction` — espiar el delegate de nivel
      // superior no lo interceptaría (mismo caveat que en el molde de Redsys).
      // En su lugar: dejar que la transacción REAL corra hasta el final
      // (Subscription y Entitlement extendidos de verdad, Transaction escrita
      // de verdad) y lanzar DESPUÉS desde el callback — Prisma reacciona igual
      // que ante una sentencia fallida y revierte TODA la transacción.
      const prismaService = app.get(PrismaService);
      const realTransaction = prismaService.$transaction.bind(prismaService);
      const transactionSpy = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
          realTransaction(async (tx: unknown) => {
            await fn(tx);
            throw new Error('Simulated transient DB failure right after extending the entitlement');
          })) as unknown as typeof prismaService.$transaction);

      const job = {
        name: BILLING_JOB.PROCESS_STRIPE_EVENT,
        data: { eventType: STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, payload: invoiceBObj, metadata: {} },
      } as unknown as Job<BillingJobData>;

      try {
        // Intento 1: la transacción atómica (extender + registrar Transaction)
        // falla a mitad de camino → Postgres revierte TODO.
        await expect(processor.process(job)).rejects.toThrow('Simulated transient DB failure');

        const subAfterFirstAttempt = await prisma.subscription.findUniqueOrThrow({
          where: { gatewaySubscriptionId },
        });
        expect(Math.floor(subAfterFirstAttempt.currentPeriodEnd.getTime() / 1000)).toBe(periodAEnd); // revertido

        const entitlementAfterFirstAttempt = await prisma.entitlement.findFirstOrThrow({
          where: { subscriptionId: subAfterFirstAttempt.id, type: EntitlementType.PRO_SUBSCRIPTION },
        });
        expect(Math.floor(entitlementAfterFirstAttempt.expiresAt!.getTime() / 1000)).toBe(periodAEnd); // revertido

        const txAfterFirstAttempt = await prisma.transaction.findUnique({
          where: { gatewayInvoiceId: invoiceBId },
        });
        expect(txAfterFirstAttempt).toBeNull(); // revertido junto con el resto

        transactionSpy.mockRestore();

        // Intento 2: BullMQ reintenta el MISMO job. Sin rastro del intento 1,
        // la atómica concede limpio.
        await processor.process(job);

        const subAfterRetry = await prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } });
        expect(Math.floor(subAfterRetry.currentPeriodEnd.getTime() / 1000)).toBe(periodBEnd);

        const entitlementsAfterRetry = await prisma.entitlement.findMany({
          where: { subscriptionId: subAfterFirstAttempt.id, type: EntitlementType.PRO_SUBSCRIPTION },
        });
        expect(entitlementsAfterRetry).toHaveLength(1); // no se duplicó el entitlement
        expect(Math.floor(entitlementsAfterRetry[0]!.expiresAt!.getTime() / 1000)).toBe(periodBEnd);

        const transactionsAfterRetry = await prisma.transaction.findMany({
          where: { gatewayInvoiceId: invoiceBId },
        });
        expect(transactionsAfterRetry).toHaveLength(1); // no se duplicó la Transaction
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  // ── 6. Pago fallido de la renovación ──────────────────────────────────────

  it('invoice.payment_failed → Subscription PAST_DUE, pero el Entitlement Pro NO se revoca (sigue activo hasta expiresAt)', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();

    const failedInvoiceId = `in_e2e_${n}_failed`;
    const failEvent = signedEvent(`evt_e2e_failed_${n}`, STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
      id: failedInvoiceId,
      object: 'invoice',
      customer: stripeCustomerId,
      lines: { data: [{ subscription: gatewaySubscriptionId }] },
    });

    const res = await postWebhook(failEvent.bodyStr, failEvent.signature).expect(200);
    expect(res.body).toEqual({ received: true });

    const sub = await pollUntil(
      () => prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } }),
      (s) => s.status !== SubscriptionStatus.ACTIVE,
    );
    expect(sub.status).toBe(SubscriptionStatus.PAST_DUE);

    // El Entitlement Pro no se toca: el usuario mantiene el acceso hasta que
    // expiresAt (fijado por la última factura pagada) pase de forma natural —
    // no hay corte inmediato ni periodo de gracia explícito, solo degradación
    // natural si no llega una renovación exitosa a tiempo.
    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { subscriptionId: sub.id, type: EntitlementType.PRO_SUBSCRIPTION },
    });
    expect(entitlement.revokedAt).toBeNull();
    expect(Math.floor(entitlement.expiresAt!.getTime() / 1000)).toBe(periodAEnd);
  }, 20_000);

  // ── 7. Cancelación ─────────────────────────────────────────────────────────

  it('customer.subscription.deleted → Subscription CANCELED, pero el Entitlement Pro NO se revoca de inmediato (respeta el periodo ya pagado)', async () => {
    const { n, gatewaySubscriptionId, stripeCustomerId, periodAEnd } = await setupSubscriptionWithFirstInvoice();

    const cancelEvent = signedEvent(`evt_e2e_cancel_${n}`, STRIPE_EVENTS.SUBSCRIPTION_DELETED, {
      id: gatewaySubscriptionId,
      object: 'subscription',
      customer: stripeCustomerId,
      status: 'canceled',
      canceled_at: Math.floor(Date.now() / 1000),
      // Realista (Stripe siempre incluye items en customer.subscription.*):
      // handleSubscriptionDeleted evalúa resolveUserIdFromCustomer/resolvePriceId
      // como parte del objeto `create` del upsert incluso cuando termina
      // ejecutando `update` (evaluación de argumentos de JS, no lazy) — sin esto
      // el test fallaría por una razón ajena a lo que se está comprobando.
      items: {
        data: [
          {
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + ONE_MONTH_SECONDS,
            price: { id: gatewayPriceId },
          },
        ],
      },
    });

    const res = await postWebhook(cancelEvent.bodyStr, cancelEvent.signature).expect(200);
    expect(res.body).toEqual({ received: true });

    const sub = await pollUntil(
      () => prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } }),
      (s) => s.status !== SubscriptionStatus.ACTIVE,
    );
    expect(sub.status).toBe(SubscriptionStatus.CANCELED);
    // El periodo ya pagado no se toca — sigue siendo el de la última factura.
    expect(Math.floor(sub.currentPeriodEnd.getTime() / 1000)).toBe(periodAEnd);

    const entitlement = await prisma.entitlement.findFirstOrThrow({
      where: { subscriptionId: sub.id, type: EntitlementType.PRO_SUBSCRIPTION },
    });
    expect(entitlement.revokedAt).toBeNull();
    expect(Math.floor(entitlement.expiresAt!.getTime() / 1000)).toBe(periodAEnd);
  }, 20_000);

  // ── 8. El .catch() que tragaba errores al guardar stripeCustomerId ────────
  //
  // billing.processor.ts:145 hacía `.catch(() => undefined)` sobre el
  // `prisma.user.update(stripeCustomerId)`. Si fallaba, el resto del handler
  // seguía como si nada — el usuario podía acabar pagando sin que su
  // stripeCustomerId quedara vinculado, y el siguiente pago crearía OTRO
  // cliente en Stripe. Arreglado: ya no se traga. Este test verifica
  // EJERCIENDO, no leyendo el diff, que el fallo ahora es ruidoso.

  describe('billing.processor.ts — el .catch() que tragaba errores al guardar stripeCustomerId', () => {
    it('si falla el guardado de stripeCustomerId, el job FALLA (ya no se traga en silencio) y el reintento se recupera limpio', async () => {
      counter += 1;
      const n = `${counter}_${RUN_ID}`;
      const userId = await createBuyer();
      const stripeCustomerId = `cus_e2e_fail_${n}`;
      const gatewaySubscriptionId = `sub_e2e_fail_${n}`;
      const sessionObj = checkoutSessionObject(userId, stripeCustomerId, gatewaySubscriptionId, n);

      const prismaService = app.get(PrismaService);
      const updateSpy = jest
        .spyOn(prismaService.user, 'update')
        .mockRejectedValueOnce(new Error('Simulated Postgres failure while saving stripeCustomerId'));

      const job = {
        name: BILLING_JOB.PROCESS_STRIPE_EVENT,
        data: { eventType: STRIPE_EVENTS.CHECKOUT_SESSION_COMPLETED, payload: sessionObj, metadata: {} },
      } as unknown as Job<BillingJobData>;

      try {
        await expect(processor.process(job)).rejects.toThrow(
          'Simulated Postgres failure while saving stripeCustomerId',
        );

        // El fallo ocurrió ANTES de tocar Subscription/Entitlement — nada a medias.
        const sub = await prisma.subscription.findUnique({ where: { gatewaySubscriptionId } });
        expect(sub).toBeNull();
        const userAfterFailure = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(userAfterFailure.stripeCustomerId).toBeNull();
      } finally {
        updateSpy.mockRestore();
      }

      // Reintento (en producción, BullMQ lo haría solo — QUEUE_BILLING tiene
      // retry). Sin el mock, el guardado funciona y el resto del handler se
      // ejecuta limpio: ni cliente Stripe duplicado ni Subscription huérfana.
      await processor.process(job);

      const userAfterRetry = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(userAfterRetry.stripeCustomerId).toBe(stripeCustomerId);
      const subAfterRetry = await prisma.subscription.findUniqueOrThrow({ where: { gatewaySubscriptionId } });
      expect(subAfterRetry.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });
});
