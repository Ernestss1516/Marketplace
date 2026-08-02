/**
 * Redsys — camino completo de pago con tarjeta para comprar un pack de créditos (e2e)
 *
 * Contraparte de redsys-featured-payment-e2e.e2e-spec.ts para el OTRO camino de
 * pago por Redsys. redsys.e2e-spec.ts ejerce `RedsysProcessor.handlePackPurchase`
 * a fondo pero SIEMPRE llamando a `processSuccess()` directamente, saltándose:
 *   - La verificación real de firma HMAC-SHA256 (RedsysWebhookGuard.canActivate)
 *   - El endpoint HTTP POST /webhooks/redsys
 *   - El paso por la cola BullMQ real (QUEUE_REDSYS)
 *
 * Este archivo cierra ese hueco usando `serializeAndSignJSONRequest` de la propia
 * librería `redsys-easy` para construir notificaciones firmadas válidas con la
 * misma REDSYS_SECRET_KEY que usa el guard — igual que hace el molde del
 * destacado, no es un atajo.
 *
 * PREMISA A CONFIRMAR/REFUTAR: el arreglo de atomicidad del destacado
 * (grantFeaturedListingAndSucceed) se justificó diciendo que este camino de
 * créditos "ya usaba el mismo patrón atómico". El escenario 5 de este archivo
 * (fallo transitorio a mitad de la transacción) es la comprobación real de esa
 * afirmación: fuerza un ROLLBACK de Postgres real y comprueba que un reintento
 * de BullMQ parte de un estado limpio, sin duplicar créditos.
 */

import { INestApplication } from '@nestjs/common';
import { CreditLedgerType, Prisma, PrismaClient, TransactionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { serializeAndSignJSONRequest } from 'redsys-easy';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { pollFor } from './helpers/async-state';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

describe('Redsys — camino completo de pago con tarjeta para pack de créditos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let packBasicoId: string;
  let packBasicoPriceId: string;
  let packBasicoCreditAmount: number;
  let packBasicoAmountEur: Prisma.Decimal;

  const SECRET_KEY = process.env.REDSYS_SECRET_KEY!;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    processor = app.get(RedsysProcessor);

    const pack = await prisma.creditPack.findFirst({
      where: { name: 'Pack Básico' },
      include: { price: true },
    });
    if (!pack?.price) throw new Error('Pack Básico not found in test seed — run seed-test.ts');
    packBasicoId = pack.id;
    packBasicoPriceId = pack.price.id;
    packBasicoCreditAmount = pack.creditAmount;
    packBasicoAmountEur = pack.price.amount;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  let buyerCounter = 0;

  /** Creates a fresh buyer per test so wallet balances/ledgers never leak between scenarios. */
  async function createBuyer(): Promise<{ token: string; userId: string }> {
    buyerCounter += 1;
    const email = `redsys-credits-e2e-${buyerCounter}-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `Redsys Credits E2E ${buyerCounter}`,
        slug: `redsys-credits-e2e-${buyerCounter}-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    const token = login.body.accessToken as string;
    if (!token) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
    return { token, userId: user.id };
  }

  /** Starts a real credits-pack checkout via HTTP and returns the created PENDING Transaction. */
  async function startCheckout(token: string, userId: string) {
    await request(app.getHttpServer())
      .post('/api/billing/checkout/credits-pack')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId: packBasicoId })
      .expect(201);

    const tx = await prisma.transaction.findFirstOrThrow({
      where: { userId, status: TransactionStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    return { tx };
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
      // Campos adicionales confirmados contra el sandbox REAL de Redsys
      // (verificación 2026-07-14 con túnel público + tarjeta de prueba —
      // ver docs/estado-tecnico.md, "Redsys — verificación contra el sandbox
      // real"). El procesador no los lee hoy, pero SIEMPRE están presentes
      // en una notificación real; se incluyen para que esta simulación deje
      // de ser un subconjunto artificial de lo que Redsys manda de verdad.
      Ds_Date: '14/07/2026',
      Ds_Hour: '19:49',
      Ds_SecurePayment: '1',
      Ds_Card_Country: '724',
      Ds_Terminal: '001',
      Ds_MerchantData: '',
      Ds_TransactionType: '0',
      Ds_ConsumerLanguage: '1',
      Ds_AuthorisationCode: '167157',
      Ds_Card_Brand: '1',
      Ds_Card_Typology: 'CONSUMO',
      Ds_ProcessedPayMethod: '78',
      Ds_ECI: '05',
      Ds_Response_Description: 'OPERACION AUTORIZADA',
    });
  }

  function centsFor(amount: Prisma.Decimal): string {
    return amount.mul(100).toFixed(0);
  }


  // ── 1. Camino feliz completo: checkout → webhook firmado → job → wallet acreditado ──

  it('checkout → notificación firmada real → Transaction SUCCEEDED → wallet acreditado con los créditos del pack', async () => {
    const { token, userId } = await createBuyer();
    const { tx } = await startCheckout(token, userId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(packBasicoAmountEur),
      dsResponse: '0000',
    });

    const res = await request(app.getHttpServer())
      .post('/api/webhooks/redsys')
      .send(notification)
      .expect(200);
    expect(res.body).toEqual({ received: true });

    // BullMQ procesa el job de forma asíncrona — esperar a que la Transaction llegue a SUCCEEDED.
    // Como wallet + ledger + status se escriben en la MISMA transacción Postgres
    // atómica (handlePackPurchase), observar SUCCEEDED aquí ya garantiza que el
    // resto también está commiteado — no hace falta un poll aparte para el wallet.
    const finalTx = await pollFor(
      () => prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
      (t) => t.status !== TransactionStatus.PENDING,
    );
    expect(finalTx.status).toBe(TransactionStatus.SUCCEEDED);

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: { entries: true },
    });
    expect(wallet).not.toBeNull();
    expect(wallet!.balance).toBe(packBasicoCreditAmount);
    expect(wallet!.entries).toHaveLength(1);
    expect(wallet!.entries[0]!.type).toBe(CreditLedgerType.PACK_PURCHASE);
    expect(wallet!.entries[0]!.amount).toBe(packBasicoCreditAmount);
    expect(wallet!.entries[0]!.referenceType).toBe('Transaction');
    expect(wallet!.entries[0]!.referenceId).toBe(tx.id);
  });

  // ── 2. Firma inválida: rechazada, no acredita nada ────────────────────────
  //
  // CRÍTICO para dinero: sin esta verificación, cualquiera podría regalarse
  // créditos forjando una notificación con un Ds_Order de una compra propia.

  it('firma inválida → 400, no se acreditan créditos, Transaction sigue PENDING', async () => {
    const { token, userId } = await createBuyer();
    const { tx } = await startCheckout(token, userId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(packBasicoAmountEur),
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

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet).toBeNull();

    // Ni siquiera se registra el GatewayEvent — el guard rechaza antes de esa fase.
    const gatewayEvent = await prisma.gatewayEvent.findUnique({ where: { gatewayEventId: dsOrder } });
    expect(gatewayEvent).toBeNull();
  });

  // ── 3. Notificación duplicada: Redsys puede reintentar su propia notificación ──

  it('notificación duplicada (mismo Ds_Order dos veces) → segunda vez marcada duplicate, no acredita dos veces', async () => {
    const { token, userId } = await createBuyer();
    const { tx } = await startCheckout(token, userId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(packBasicoAmountEur),
      dsResponse: '0000',
    });

    const first = await request(app.getHttpServer()).post('/api/webhooks/redsys').send(notification).expect(200);
    expect(first.body).toEqual({ received: true });

    const second = await request(app.getHttpServer()).post('/api/webhooks/redsys').send(notification).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    await pollFor(
      () => prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
      (t) => t.status !== TransactionStatus.PENDING,
    );

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId },
      include: { entries: true },
    });
    expect(wallet.balance).toBe(packBasicoCreditAmount);
    expect(wallet.entries).toHaveLength(1);
  });

  // ── 4. El job se reintenta (BullMQ) después de ya haber acreditado con éxito ──
  //
  // El retry de QUEUE_REDSYS (attempts:3, backoff exponencial) puede en teoría
  // volver a invocar processSuccess() para el mismo job aunque ya haya
  // completado (p. ej. el worker cae justo tras el commit, antes de que BullMQ
  // marque el job como completado). La guarda de "idempotencia capa 2"
  // (Transaction.status !== PENDING) debe impedir un doble abono.

  it('reintento de BullMQ tras Transaction ya SUCCEEDED → no duplica el abono', async () => {
    const { token, userId } = await createBuyer();
    const { tx } = await startCheckout(token, userId);
    const dsOrder = tx.gatewayPaymentIntentId!;
    const cents = centsFor(packBasicoAmountEur);

    const notification = buildSignedNotification({ dsOrder, dsAmountCents: cents, dsResponse: '0000' });
    await request(app.getHttpServer()).post('/api/webhooks/redsys').send(notification).expect(200);

    await pollFor(
      () => prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
      (t) => t.status !== TransactionStatus.PENDING,
    );

    // Simula un reintento espurio de BullMQ para el mismo job, ya con la Transaction SUCCEEDED.
    await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder });

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId },
      include: { entries: true },
    });
    expect(wallet.balance).toBe(packBasicoCreditAmount);
    expect(wallet.entries).toHaveLength(1);
  });

  // ── 5. Pago rechazado por Redsys (tarjeta rechazada / usuario cancela) ────

  it('Ds_Response distinto de 0000 (pago rechazado) → Transaction FAILED, no se acreditan créditos', async () => {
    const { token, userId } = await createBuyer();
    const { tx } = await startCheckout(token, userId);
    const dsOrder = tx.gatewayPaymentIntentId!;

    const notification = buildSignedNotification({
      dsOrder,
      dsAmountCents: centsFor(packBasicoAmountEur),
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

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet).toBeNull();
  });

  // ── 6. El escenario que rompió el destacado: fallo transitorio a mitad de la transacción atómica ──
  //
  // handlePackPurchase acredita el wallet + escribe el CreditLedger + marca la
  // Transaction SUCCEEDED dentro de UNA sola prisma.$transaction desde que el
  // método existe (a diferencia del destacado, que llegó a tener un bug de dos
  // pasos separados). Este test es la VERIFICACIÓN, no la lectura del código:
  // fuerza un ROLLBACK real de Postgres a mitad de la transacción y comprueba
  // que el reintento de BullMQ parte de un estado limpio, sin duplicar nada.

  describe('Retry tras fallo transitorio (justo dentro de la transacción atómica)', () => {
    it('un fallo a mitad de la transacción atómica revierte TODO (wallet + ledger + status); el reintento de BullMQ acredita limpio, una sola vez', async () => {
      const { userId } = await createBuyer();
      const tax = redsysTaxBreakdown(packBasicoAmountEur);
      const dsOrder = `20260714CRRETRY${buyerCounter}`;

      const tx = await prisma.transaction.create({
        data: {
          userId,
          priceId: packBasicoPriceId,
          ...tax,
          status: TransactionStatus.PENDING,
          gateway: 'REDSYS',
          gatewayPaymentIntentId: dsOrder,
        },
        select: { id: true },
      });
      const cents = centsFor(packBasicoAmountEur);

      // Mismo truco que en redsys-featured-payment-e2e.e2e-spec.ts: dejar que la
      // transacción REAL corra hasta el final (wallet creado de verdad, ledger
      // escrito de verdad, status actualizado de verdad) y lanzar DESPUÉS desde
      // el callback. Prisma reacciona exactamente como ante una sentencia
      // fallida: revierte TODA la transacción. Esto ejercita un ROLLBACK real
      // de Postgres, no una aproximación mockeada.
      const prismaService = app.get(PrismaService);
      const realTransaction = prismaService.$transaction.bind(prismaService);
      const transactionSpy = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
          realTransaction(async (tx: unknown) => {
            await fn(tx);
            throw new Error('Simulated transient DB failure right after wallet credit');
          })) as unknown as typeof prismaService.$transaction);

      try {
        // Intento 1: la transacción atómica (wallet + ledger + update a
        // SUCCEEDED) falla a mitad de camino → Postgres revierte TODO.
        await expect(
          processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder }),
        ).rejects.toThrow('Simulated transient DB failure');

        const walletAfterFirstAttempt = await prisma.wallet.findUnique({ where: { userId } });
        expect(walletAfterFirstAttempt).toBeNull(); // revertido junto con el resto de la tx

        const txAfterFirstAttempt = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
        expect(txAfterFirstAttempt.status).toBe(TransactionStatus.PENDING);

        // Intento 2: BullMQ reintenta el MISMO job. Sin wallet ni ledger
        // previos, la atómica parte de cero y acredita limpio.
        await processor.processSuccess({ transactionId: tx.id, dsAmount: cents, dsOrder });

        const txAfterRetry = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
        expect(txAfterRetry.status).toBe(TransactionStatus.SUCCEEDED);

        const wallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId },
          include: { entries: true },
        });
        expect(wallet.balance).toBe(packBasicoCreditAmount); // ni un céntimo de más
        expect(wallet.entries).toHaveLength(1);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });
});
