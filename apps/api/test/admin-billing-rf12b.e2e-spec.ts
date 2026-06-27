/**
 * RF.12b — Manual credit accrual (e2e)
 *
 * POST /admin/billing/users/:userId/credits
 * Body: { amount: number, reason: string }
 *
 * Invariants verified:
 *   - Atomicity: Wallet.balance + CreditLedger + AuditLog in one transaction
 *   - CreditLedger.note is user-facing generic text (not the admin reason)
 *   - AuditLog.after.reason contains the admin's internal reason
 *   - No Transaction record is created (not a taxable event)
 *   - Wallet upsert: creates wallet when it doesn't exist
 *   - No Pro bonus applied — credited amount is exactly dto.amount
 *
 * Security:
 *   - 401 without auth
 *   - 403 for USER and MODERATOR roles (billing is ADMIN-only)
 */

import { INestApplication } from '@nestjs/common';
import { CreditLedgerType, PrismaClient, TransactionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Admin Billing RF.12b — Credit grant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;

  let adminId: string;
  let targetUserId: string;   // has no wallet at start — tests upsert path
  let walletUserId: string;   // has an existing wallet with balance

  const INITIAL_BALANCE = 50;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    // ── Users ───────────────────────────────────────────────────────────────

    const [admin, regular, moderator, target, withWallet] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'rb-admin@example.com',
          name: 'RB Admin',
          slug: 'rb-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rb-user@example.com',
          name: 'RB User',
          slug: 'rb-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rb-mod@example.com',
          name: 'RB Mod',
          slug: 'rb-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rb-target@example.com',
          name: 'RB Target (no wallet)',
          slug: 'rb-target',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'rb-wallet@example.com',
          name: 'RB Wallet User',
          slug: 'rb-wallet',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
    ]);

    adminId = admin.id;
    targetUserId = target.id;
    walletUserId = withWallet.id;
    void regular;
    void moderator;

    // Create an existing wallet for walletUserId
    await prisma.wallet.create({
      data: { userId: withWallet.id, balance: INITIAL_BALANCE },
    });

    // ── Login tokens ─────────────────────────────────────────────────────────

    const [adminRes, userRes, modRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rb-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rb-user@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rb-mod@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
    moderatorToken = modRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Security ──────────────────────────────────────────────────────────────────

  it('POST /api/admin/billing/users/:id/credits sin auth → 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .send({ amount: 10, reason: 'test reason' })
      .expect(401);
  });

  it('POST /api/admin/billing/users/:id/credits como USER → 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 10, reason: 'test reason' })
      .expect(403);
  });

  it('POST /api/admin/billing/users/:id/credits como MODERATOR → 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ amount: 10, reason: 'test reason' })
      .expect(403);
  });

  // ── Validación de entrada ─────────────────────────────────────────────────────

  it('amount = 0 → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 0, reason: 'motivo válido' })
      .expect(400);
  });

  it('amount = -1 → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: -1, reason: 'motivo válido' })
      .expect(400);
  });

  it('amount = 10001 → 400 (supera el máximo)', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 10001, reason: 'motivo válido' })
      .expect(400);
  });

  it('reason vacío → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 10, reason: '' })
      .expect(400);
  });

  it('reason demasiado corta (< 5 chars) → 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 10, reason: 'abc' })
      .expect(400);
  });

  it('userId inexistente → 404', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/billing/users/xxxxxxxx-0000-0000-0000-000000000000/credits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 10, reason: 'motivo válido suficiente' })
      .expect(404);
  });

  // ── Acreditación exitosa (wallet existente) ───────────────────────────────────

  it('Acreditación exitosa: balance sube exactamente el importe (sin bonus)', async () => {
    const GRANT = 100;

    const res = await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: GRANT, reason: 'Compensación por incidencia #1234' })
      .expect(200);

    expect(res.body.creditedAmount).toBe(GRANT);
    expect(res.body.balance).toBe(INITIAL_BALANCE + GRANT);

    // Verify in DB
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: walletUserId } });
    expect(wallet.balance).toBe(INITIAL_BALANCE + GRANT);
  });

  it('CreditLedger tiene type=ADMIN_CREDIT, amount correcto, note genérica (no el reason del admin)', async () => {
    const ledger = await prisma.creditLedger.findFirst({
      where: {
        type: CreditLedgerType.ADMIN_CREDIT,
        wallet: { userId: walletUserId },
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(ledger).not.toBeNull();
    expect(ledger!.amount).toBe(100);
    // Note is user-facing generic text — must NOT contain the admin's internal reason
    expect(ledger!.note).toBe('Créditos añadidos por el equipo');
    expect(ledger!.note).not.toContain('incidencia');
  });

  it('AuditLog tiene action=ADMIN_CREDIT_GRANT con before/after y reason interno', async () => {
    const log = await prisma.auditLog.findFirst({
      where: { resourceId: walletUserId, action: 'ADMIN_CREDIT_GRANT' },
      orderBy: { createdAt: 'desc' },
    });

    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect(log!.resourceType).toBe('Wallet');
    expect((log!.before as { balance: number }).balance).toBe(INITIAL_BALANCE);
    expect((log!.after as { balance: number; amount: number; reason: string }).amount).toBe(100);
    expect((log!.after as { reason: string }).reason).toBe('Compensación por incidencia #1234');
  });

  it('NO se crea Transaction (no es hecho imponible)', async () => {
    const txCount = await prisma.transaction.count({ where: { userId: walletUserId } });
    expect(txCount).toBe(0);
  });

  // ── Wallet inexistente → upsert crea wallet y acredita ───────────────────────

  it('Wallet inexistente: se crea y el balance = amount acreditado', async () => {
    const GRANT = 75;

    const res = await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${targetUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: GRANT, reason: 'Creación de wallet por incidencia' })
      .expect(200);

    expect(res.body.balance).toBe(GRANT);
    expect(res.body.creditedAmount).toBe(GRANT);

    const wallet = await prisma.wallet.findUnique({ where: { userId: targetUserId } });
    expect(wallet).not.toBeNull();
    expect(wallet!.balance).toBe(GRANT);

    const ledger = await prisma.creditLedger.findFirst({
      where: { type: CreditLedgerType.ADMIN_CREDIT, wallet: { userId: targetUserId } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.amount).toBe(GRANT);
  });

  // ── Acumulación de acreditaciones ─────────────────────────────────────────────

  it('Dos acreditaciones seguidas acumulan el balance correctamente', async () => {
    const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: walletUserId } });
    const balanceBefore = walletBefore.balance;

    await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50, reason: 'Primera acreditación adicional' })
      .expect(200);

    const res2 = await request(app.getHttpServer())
      .post(`/api/admin/billing/users/${walletUserId}/credits`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 25, reason: 'Segunda acreditación adicional' })
      .expect(200);

    expect(res2.body.balance).toBe(balanceBefore + 50 + 25);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: walletUserId } });
    expect(wallet.balance).toBe(balanceBefore + 50 + 25);
  });

  // ── Atomicidad: wallet + ledger + auditlog cuadran ───────────────────────────

  it('Atomicidad: wallet.balance === suma de todas las entradas ADMIN_CREDIT del ledger + balance inicial', async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: walletUserId } });

    const adminCredits = await prisma.creditLedger.findMany({
      where: {
        type: CreditLedgerType.ADMIN_CREDIT,
        wallet: { userId: walletUserId },
      },
    });

    const totalAdminCredits = adminCredits.reduce((sum, e) => sum + e.amount, 0);

    // Initial balance (50) + all admin credits should equal current balance
    expect(wallet.balance).toBe(INITIAL_BALANCE + totalAdminCredits);
  });

  it('Número de AuditLogs ADMIN_CREDIT_GRANT = número de acreditaciones realizadas', async () => {
    const ledgerCount = await prisma.creditLedger.count({
      where: {
        type: CreditLedgerType.ADMIN_CREDIT,
        wallet: { userId: walletUserId },
      },
    });

    const auditCount = await prisma.auditLog.count({
      where: { resourceId: walletUserId, action: 'ADMIN_CREDIT_GRANT' },
    });

    // One AuditLog per CreditLedger entry — enforced by atomic transaction
    expect(auditCount).toBe(ledgerCount);
  });

  // ── El flujo existente de admin.e2e (AuditLogService sin tx) sigue funcionando ─

  it('AuditLogService sin tx (callers existentes) sigue siendo compatible', async () => {
    // A simple admin stats call exercises the app without tx audit — ensures
    // the optional-param refactor did not break existing callers.
    await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
