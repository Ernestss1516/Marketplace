/**
 * RF.12a — Admin Billing read-only endpoints (e2e)
 *
 * Covers:
 *   - GET /admin/billing/transactions  (filters: gateway, status, userId, dateFrom/dateTo; pagination)
 *   - GET /admin/billing/wallets       (filter: q; pagination)
 *   - GET /admin/billing/users/:userId (wallet + active entitlements + last 10 transactions)
 *
 * Security (highest priority):
 *   - 401 without auth token
 *   - 403 for USER role
 *   - 403 for MODERATOR role (billing is ADMIN-only)
 *
 * Active-entitlement invariant:
 *   - revokedAt != null → NOT active even if expiresAt is in the future
 *
 * No gateway IDs in output:
 *   - gatewayPaymentIntentId, gatewayInvoiceId, gatewayChargeId must NOT appear
 */

import { INestApplication } from '@nestjs/common';
import {
  CreditLedgerType,
  EntitlementType,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Admin Billing RF.12a (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;

  let billableUserId: string;

  // Seeded IDs used across tests
  let txSucceededId: string;
  let txFailedId: string;
  let walletId: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    // ── Users ───────────────────────────────────────────────────────────────

    const [admin, regularUser, moderator, billable] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'ab-admin@example.com',
          name: 'AB Admin',
          slug: 'ab-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ab-user@example.com',
          name: 'AB Regular User',
          slug: 'ab-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ab-mod@example.com',
          name: 'AB Moderator',
          slug: 'ab-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ab-billable@example.com',
          name: 'AB Billable User',
          slug: 'ab-billable',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
    ]);

    billableUserId = billable.id;
    void admin;
    void regularUser;
    void moderator;

    // ── Product + Price (FK required by Transaction) ─────────────────────────

    const product = await prisma.product.create({
      data: {
        name: 'Test Pack AB',
        type: 'ONE_TIME',
        active: true,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        amount: 9.99,
        currency: 'EUR',
        active: true,
      },
    });

    // ── Transactions ─────────────────────────────────────────────────────────

    const [txSucceeded, txFailed] = await Promise.all([
      prisma.transaction.create({
        data: {
          userId: billable.id,
          priceId: price.id,
          amountGross: 9.99,
          amountNet: 8.26,
          taxAmount: 1.73,
          taxRate: 0.21,
          currency: 'EUR',
          status: TransactionStatus.SUCCEEDED,
          gateway: 'REDSYS',
          // Intentionally NOT setting gatewayPaymentIntentId/gatewayInvoiceId/gatewayChargeId
          // to confirm the select never returns them even if set.
        },
      }),
      prisma.transaction.create({
        data: {
          userId: billable.id,
          priceId: price.id,
          amountGross: 9.99,
          amountNet: 8.26,
          taxAmount: 1.73,
          taxRate: 0.21,
          currency: 'EUR',
          status: TransactionStatus.FAILED,
          gateway: 'STRIPE',
        },
      }),
    ]);

    txSucceededId = txSucceeded.id;
    txFailedId = txFailed.id;

    // ── Wallet + CreditLedger ────────────────────────────────────────────────

    const wallet = await prisma.wallet.create({
      data: {
        userId: billable.id,
        balance: 150,
        entries: {
          create: [
            {
              type: CreditLedgerType.PACK_PURCHASE,
              amount: 200,
              referenceType: 'Transaction',
              referenceId: txSucceeded.id,
            },
            {
              type: CreditLedgerType.FEATURED_DEBIT,
              amount: -50,
              referenceType: 'Listing',
              referenceId: 'listing-placeholder-id',
            },
          ],
        },
      },
    });

    walletId = wallet.id;

    // ── Entitlements (active + revoked) ──────────────────────────────────────

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 1000);

    await prisma.entitlement.create({
      data: {
        userId: billable.id,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: future,
        revokedAt: null,
      },
    });

    // Revoked entitlement — expiresAt is in the future but revokedAt is set.
    // Must NOT appear in active entitlements response.
    await prisma.entitlement.create({
      data: {
        userId: billable.id,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: future,
        revokedAt: past,
      },
    });

    // ── Login tokens ─────────────────────────────────────────────────────────

    const [adminRes, userRes, modRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ab-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ab-user@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ab-mod@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
    moderatorToken = modRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Security: transactions ────────────────────────────────────────────────────

  it('GET /api/admin/billing/transactions sin auth → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .expect(401);
  });

  it('GET /api/admin/billing/transactions como USER → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /api/admin/billing/transactions como MODERATOR → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  // ── Security: wallets ─────────────────────────────────────────────────────────

  it('GET /api/admin/billing/wallets sin auth → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/wallets')
      .expect(401);
  });

  it('GET /api/admin/billing/wallets como USER → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/wallets')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /api/admin/billing/wallets como MODERATOR → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/wallets')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  // ── Security: user billing detail ─────────────────────────────────────────────

  it('GET /api/admin/billing/users/:id sin auth → 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${billableUserId}`)
      .expect(401);
  });

  it('GET /api/admin/billing/users/:id como USER → 403', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${billableUserId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /api/admin/billing/users/:id como MODERATOR → 403', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${billableUserId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(403);
  });

  // ── Transactions: lista y filtros ─────────────────────────────────────────────

  it('GET /api/admin/billing/transactions → lista paginada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(typeof res.body.perPage).toBe('number');

    const firstItem = res.body.items[0] as Record<string, unknown>;
    expect(firstItem).toHaveProperty('id');
    expect(firstItem).toHaveProperty('gateway');
    expect(firstItem).toHaveProperty('status');
    expect(firstItem).toHaveProperty('amountGross');
    expect(firstItem).toHaveProperty('currency');
    expect(firstItem).toHaveProperty('createdAt');
    expect(firstItem).toHaveProperty('user');
    expect((firstItem.user as Record<string, unknown>)).toHaveProperty('email');
  });

  it('GET /api/admin/billing/transactions → no expone IDs de pasarela', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const item of res.body.items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('gatewayPaymentIntentId');
      expect(item).not.toHaveProperty('gatewayInvoiceId');
      expect(item).not.toHaveProperty('gatewayChargeId');
    }
  });

  it('GET /api/admin/billing/transactions?gateway=REDSYS → solo transacciones REDSYS', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions?gateway=REDSYS')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { gateway: string }[]).every((t) => t.gateway === 'REDSYS'),
    ).toBe(true);
  });

  it('GET /api/admin/billing/transactions?gateway=STRIPE → solo transacciones STRIPE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions?gateway=STRIPE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { gateway: string }[]).every((t) => t.gateway === 'STRIPE'),
    ).toBe(true);
  });

  it('GET /api/admin/billing/transactions?status=SUCCEEDED → solo transacciones SUCCEEDED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions?status=SUCCEEDED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { status: string }[]).every((t) => t.status === 'SUCCEEDED'),
    ).toBe(true);
  });

  it('GET /api/admin/billing/transactions?status=FAILED → solo transacciones FAILED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/transactions?status=FAILED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { status: string }[]).every((t) => t.status === 'FAILED'),
    ).toBe(true);
  });

  it('GET /api/admin/billing/transactions?userId=xxx → solo transacciones de ese usuario', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/transactions?userId=${billableUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(
      (res.body.items as { user: { id: string } }[]).every(
        (t) => t.user.id === billableUserId,
      ),
    ).toBe(true);
  });

  it('GET /api/admin/billing/transactions?dateFrom/dateTo → filtra por fecha', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/transactions?dateFrom=${yesterday}&dateTo=${tomorrow}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);

    // A range that excludes all test data
    const futureFrom = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const futureTo = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();

    const emptyRes = await request(app.getHttpServer())
      .get(
        `/api/admin/billing/transactions?userId=${billableUserId}&dateFrom=${futureFrom}&dateTo=${futureTo}`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(emptyRes.body.total).toBe(0);
  });

  it('GET /api/admin/billing/transactions paginación: page=1&perPage=1 devuelve 1 item, total>=2', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/transactions?userId=${billableUserId}&page=1&perPage=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.perPage).toBe(1);
  });

  it('GET /api/admin/billing/transactions paginación: page=2&perPage=1 devuelve el segundo item', async () => {
    const p1 = await request(app.getHttpServer())
      .get(`/api/admin/billing/transactions?userId=${billableUserId}&page=1&perPage=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const p2 = await request(app.getHttpServer())
      .get(`/api/admin/billing/transactions?userId=${billableUserId}&page=2&perPage=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(p2.body.items).toHaveLength(1);
    expect((p1.body.items[0] as { id: string }).id).not.toBe(
      (p2.body.items[0] as { id: string }).id,
    );
  });

  it('GET /api/admin/billing/transactions status inválido → 400', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/transactions?status=NO_EXISTE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  // ── Wallets: lista y búsqueda ─────────────────────────────────────────────────

  it('GET /api/admin/billing/wallets → lista paginada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.page).toBe(1);

    const firstItem = res.body.items[0] as Record<string, unknown>;
    expect(firstItem).toHaveProperty('id');
    expect(firstItem).toHaveProperty('balance');
    expect(firstItem).toHaveProperty('updatedAt');
    expect(firstItem).toHaveProperty('user');
    const user = firstItem.user as Record<string, unknown>;
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
  });

  it('GET /api/admin/billing/wallets?q=Billable → filtra por nombre del usuario', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/wallets?q=Billable')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { user: { name: string } }[]).some((w) =>
        w.user.name.toLowerCase().includes('billable'),
      ),
    ).toBe(true);
  });

  it('GET /api/admin/billing/wallets?q=ab-billable → filtra por email del usuario', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/wallets?q=ab-billable')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as { user: { email: string } }[]).some((w) =>
        w.user.email.includes('ab-billable'),
      ),
    ).toBe(true);
  });

  it('GET /api/admin/billing/wallets?q=inexistente → 0 resultados', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/billing/wallets?q=zzz-no-existe-en-db-zzz')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  // ── Detalle de usuario (wallet + entitlements + transactions) ─────────────────

  it('GET /api/admin/billing/users/:userId → devuelve estructura completa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${billableUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.user.id).toBe(billableUserId);
    expect(res.body.user.email).toBe('ab-billable@example.com');

    // Wallet
    expect(res.body.wallet).not.toBeNull();
    expect(res.body.wallet.id).toBe(walletId);
    expect(res.body.wallet.balance).toBe(150);
    expect(Array.isArray(res.body.wallet.entries)).toBe(true);
    expect(res.body.wallet.entries.length).toBeGreaterThanOrEqual(2);

    // Ledger entries — no gateway IDs
    for (const entry of res.body.wallet.entries as Record<string, unknown>[]) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('amount');
      expect(entry).not.toHaveProperty('gatewayPaymentIntentId');
    }

    // Transactions (last 10)
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThanOrEqual(2);

    const txIds = (res.body.transactions as { id: string }[]).map((t) => t.id);
    expect(txIds).toContain(txSucceededId);
    expect(txIds).toContain(txFailedId);

    // Transactions: no gateway IDs
    for (const tx of res.body.transactions as Record<string, unknown>[]) {
      expect(tx).not.toHaveProperty('gatewayPaymentIntentId');
      expect(tx).not.toHaveProperty('gatewayInvoiceId');
      expect(tx).not.toHaveProperty('gatewayChargeId');
    }
  });

  it('Entitlement con revokedAt!=null NO aparece en entitlements activos', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${billableUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entitlements = res.body.entitlements as { type: string; revokedAt: string | null }[];

    // Only the PRO_SUBSCRIPTION (revokedAt=null) should appear
    expect(entitlements.every((e) => e.revokedAt === null)).toBe(true);
    expect(entitlements.some((e) => e.type === 'PRO_SUBSCRIPTION')).toBe(true);
    // The revoked FEATURED_LISTING must NOT appear
    expect(entitlements.some((e) => e.type === 'FEATURED_LISTING')).toBe(false);
  });

  it('GET /api/admin/billing/users/:userId usuario sin wallet → wallet null', async () => {
    // A new user without any billing data
    const noWalletUser = await prisma.user.create({
      data: {
        email: 'ab-nowallet@example.com',
        name: 'AB No Wallet',
        slug: 'ab-nowallet',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
        role: 'USER',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/admin/billing/users/${noWalletUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.wallet).toBeNull();
    expect(res.body.entitlements).toHaveLength(0);
    expect(res.body.transactions).toHaveLength(0);
  });

  it('GET /api/admin/billing/users/no-existe → 404', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/billing/users/xxxxxxxx-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
