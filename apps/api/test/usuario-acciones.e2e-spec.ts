/**
 * FICHA DE USUARIO — RÁFAGA U2: LAS ACCIONES DE STAFF SOBRE UN USUARIO.
 *
 * Conceder y retirar Pro a mano, dar bumps y quitar saldo. Todo ADMIN, todo con
 * motivo y todo con traza.
 *
 * LAS DOS BARRERAS:
 *
 *   1. **El Pro manual es coherente.** Concederlo deja al usuario Pro —con las
 *      capacidades— pero SIN cuota mensual, porque esa cuota es un COUNT desde el
 *      inicio de un ciclo de facturación y aquí no hay ciclo (D-1). Caduca solo
 *      al llegar su fecha, y revocarlo lo quita en el acto.
 *
 *   2. **El cliente de pago sigue protegido, ahora de verdad.** U1 lo demostró
 *      con un entitlement fabricado a mano en el test; aquí se concede el Pro
 *      manual **por el endpoint real** a alguien que está pagando, y su cuota
 *      mensual tiene que quedar intacta. Sin el arreglo de U1 esto sería una
 *      regresión en el único camino que genera ingresos.
 *
 * Ver docs/diseno-ficha-usuario.md §2, §3 y §6 (U2).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, PrismaClient, ProductType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Ficha de usuario U2 — las acciones de staff (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let moderatorToken: string;
  let adminId: string;

  const server = () => app.getHttpServer();
  const MOTIVO = 'Compensación por una incidencia de soporte';

  async function crearUsuario(sufijo: string) {
    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.create({
      data: {
        email: `u2-${sufijo}@example.com`,
        name: `U2 ${sufijo}`,
        slug: `u2-${sufijo}`,
        passwordHash,
        emailVerified: true,
      },
    });
    const token = (
      await request(server())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Test1234!' })
    ).body.accessToken as string;
    return { user, token };
  }

  /** Un Pro DE PAGO real: Subscription + Entitlement enlazado. */
  async function proDePago(userId: string) {
    const price = await prisma.price.findFirst({
      where: { product: { type: ProductType.RECURRING } },
      select: { id: true },
    });
    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId: price!.id,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gatewaySubscriptionId: `sub_u2_${userId}_${Date.now()}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId: price!.id,
        expiresAt: periodEnd,
      },
    });
    return { subscription, periodStart, periodEnd };
  }

  const enUnMes = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const conceder = (userId: string, body: Record<string, unknown>, token = adminToken) =>
    request(server())
      .post(`/api/admin/billing/users/${userId}/pro`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  async function estadoPro(token: string) {
    const res = await request(server())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`);
    return res.body as {
      isPro: boolean;
      quotaSource: string;
      limit: number;
      remaining: number;
      bumpQuota: { limit: number };
    };
  }

  const traza = (userId: string, action: string) =>
    prisma.auditLog.findMany({ where: { resourceId: userId, action } });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'u2-admin@example.com', name: 'U2 Admin', slug: 'u2-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'u2-mod@example.com', name: 'U2 Mod', slug: 'u2-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
    ]);
    adminId = admin.id;

    const login = (email: string) =>
      request(server()).post('/api/auth/admin-login').send({ email, password: 'Test1234!' });
    adminToken = (await login('u2-admin@example.com')).body.accessToken as string;
    moderatorToken = (await login('u2-mod@example.com')).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── BARRERA 1 ─────────────────────────────────────────────────────────────

  describe('BARRERA 1 — el Pro manual es coherente', () => {
    it('conceder deja al usuario Pro, SIN cuota mensual y con traza', async () => {
      const { user, token } = await crearUsuario('pro-basico');

      const res = await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO });
      expect(res.status).toBe(200);

      const estado = await estadoPro(token);
      expect(estado.isPro).toBe(true);
      // D-1: las capacidades sí, las gratuidades mensuales no.
      expect(estado.quotaSource).toBe('NONE');
      expect(estado.limit).toBe(0);
      expect(estado.bumpQuota.limit).toBe(0);

      const registros = await traza(user.id, 'PRO_GRANT');
      expect(registros).toHaveLength(1);
      expect(registros[0].actorId).toBe(adminId);
      expect(registros[0].after).toMatchObject({ reason: MOTIVO });
    });

    it('el entitlement creado NO tiene Subscription — ahí vive la procedencia', async () => {
      const { user } = await crearUsuario('procedencia');
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      const ent = await prisma.entitlement.findFirst({
        where: { userId: user.id, type: EntitlementType.PRO_SUBSCRIPTION },
      });

      expect(ent?.subscriptionId).toBeNull();
    });

    it('y NO crea Subscription: el usuario puede suscribirse de verdad después', async () => {
      // La suscripción sintética se descartó justo por esto (§1.3 del diseño).
      const { user } = await crearUsuario('puede-pagar');
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      const subs = await prisma.subscription.count({ where: { userId: user.id } });
      expect(subs).toBe(0);
    });

    it('CADUCA solo al llegar su fecha', async () => {
      const { user, token } = await crearUsuario('caduca');
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);
      expect((await estadoPro(token)).isPro).toBe(true);

      // Se adelanta el reloj moviendo la fecha: la caducidad se evalúa AL LEER,
      // así que no hace falta ningún job.
      await prisma.entitlement.updateMany({
        where: { userId: user.id, type: EntitlementType.PRO_SUBSCRIPTION },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await estadoPro(token)).isPro).toBe(false);
    });

    it('revocar lo quita en el acto, y deja traza', async () => {
      const { user, token } = await crearUsuario('revocar');
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/pro/revoke`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Concedido por error' });

      expect(res.status).toBe(200);
      expect((await estadoPro(token)).isPro).toBe(false);
      expect(await traza(user.id, 'PRO_REVOKE')).toHaveLength(1);
    });

    it('revocar NO toca un Pro DE PAGO', async () => {
      // Quitarle el entitlement a quien está pagando le retiraría lo comprado sin
      // cancelar su cobro. Eso es facturación, no soporte.
      const { user, token } = await crearUsuario('revocar-pago');
      await proDePago(user.id);

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/pro/revoke`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Intento de revocar un plan pagado' });

      expect(res.status).toBe(404);
      expect((await estadoPro(token)).isPro).toBe(true);
    });

    it('`expiresAt` es OBLIGATORIO', async () => {
      const { user } = await crearUsuario('sin-fecha');

      await conceder(user.id, { reason: MOTIVO }).expect(400);
    });

    it('una fecha pasada se rechaza', async () => {
      const { user } = await crearUsuario('fecha-pasada');

      await conceder(user.id, {
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        reason: MOTIVO,
      }).expect(400);
    });

    it('el motivo es OBLIGATORIO', async () => {
      const { user } = await crearUsuario('sin-motivo');

      await conceder(user.id, { expiresAt: enUnMes() }).expect(400);
    });
  });

  // ── BARRERA 2 ─────────────────────────────────────────────────────────────

  describe('BARRERA 2 — el cliente de pago, protegido en uso real', () => {
    it('conceder Pro manual a quien YA PAGA no le toca la cuota', async () => {
      // U1 lo demostró con un entitlement fabricado en el test; esto lo concede
      // por el endpoint real. Es la regresión que U1 existía para impedir.
      const { user, token } = await crearUsuario('pago-y-manual');
      await proDePago(user.id);

      const antes = await estadoPro(token);
      expect(antes.quotaSource).toBe('SUBSCRIPTION');
      expect(antes.limit).toBeGreaterThan(0);

      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      const despues = await estadoPro(token);
      expect(despues.isPro).toBe(true);
      expect(despues.quotaSource).toBe('SUBSCRIPTION');
      expect(despues.limit).toBe(antes.limit);
      expect(despues.remaining).toBe(antes.remaining);
      expect(despues.bumpQuota.limit).toBe(antes.bumpQuota.limit);
    });

    it('y los dos entitlements COEXISTEN', async () => {
      const { user } = await crearUsuario('coexisten');
      await proDePago(user.id);
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      const todos = await prisma.entitlement.findMany({
        where: { userId: user.id, type: EntitlementType.PRO_SUBSCRIPTION, revokedAt: null },
        select: { subscriptionId: true },
      });

      expect(todos).toHaveLength(2);
      expect(todos.filter((e) => e.subscriptionId === null)).toHaveLength(1);
      expect(todos.filter((e) => e.subscriptionId !== null)).toHaveLength(1);
    });

    it('revocar el manual deja intacto el de pago', async () => {
      const { user, token } = await crearUsuario('revoca-solo-manual');
      await proDePago(user.id);
      await conceder(user.id, { expiresAt: enUnMes(), reason: MOTIVO }).expect(200);

      await request(server())
        .post(`/api/admin/billing/users/${user.id}/pro/revoke`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Ya no hace falta' })
        .expect(200);

      const estado = await estadoPro(token);
      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('SUBSCRIPTION');
    });
  });

  // ── Bumps ─────────────────────────────────────────────────────────────────

  describe('dar bumps — el hueco que faltaba', () => {
    it('el saldo de bumps sube y queda registrado', async () => {
      const { user } = await crearUsuario('dar-bumps');

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/bumps`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 7, reason: MOTIVO });

      expect(res.status).toBe(200);
      expect(res.body.bumpBalance).toBe(7);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(wallet?.bumpBalance).toBe(7);
      // Y no toca la otra moneda: son saldos distintos.
      expect(wallet?.balance).toBe(0);

      expect(await traza(user.id, 'ADMIN_BUMP_GRANT')).toHaveLength(1);
    });

    it('el motivo NO se filtra al historial que ve el usuario', async () => {
      // El `note` del ledger lo lee el usuario en /mis-creditos; el motivo es una
      // anotación interna y vive en el AuditLog. Misma separación que grantCredits.
      const { user } = await crearUsuario('motivo-privado');
      await request(server())
        .post(`/api/admin/billing/users/${user.id}/bumps`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 3, reason: 'Nota interna que el usuario no debe leer' })
        .expect(200);

      const apunte = await prisma.bumpLedger.findFirst({
        where: { wallet: { userId: user.id } },
      });

      expect(apunte?.note).not.toContain('interna');
    });
  });

  // ── El débito ─────────────────────────────────────────────────────────────

  describe('quitar saldo (D-2) — con motivo y con suelo', () => {
    async function conCreditos(sufijo: string, cantidad: number) {
      const { user } = await crearUsuario(sufijo);
      await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: cantidad, reason: MOTIVO })
        .expect(200);
      return user;
    }

    it('baja el saldo y deja traza', async () => {
      const user = await conCreditos('debito-normal', 50);

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 20, reason: 'Corrección de una concesión errónea' });

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(30);
      expect(await traza(user.id, 'ADMIN_CREDIT_DEBIT')).toHaveLength(1);
    });

    it('EL SUELO: quitar más del saldo lo deja en CERO, nunca negativo', async () => {
      const user = await conCreditos('debito-suelo', 10);

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 500, reason: 'Se pide más de lo que hay' });

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(0);
      // Se descontó lo que había, no lo pedido.
      expect(res.body.debitedAmount).toBe(10);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(wallet?.balance).toBe(0);
    });

    it('el apunte registra lo REALMENTE descontado (el invariante del ledger)', async () => {
      // `wallet.balance == SUM(CreditLedger.amount)`. Apuntar −500 sobre un saldo
      // de 10 lo rompería.
      const user = await conCreditos('debito-invariante', 10);
      await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 500, reason: 'Se pide más de lo que hay' })
        .expect(200);

      const apuntes = await prisma.creditLedger.findMany({
        where: { wallet: { userId: user.id } },
        select: { amount: true },
      });
      const suma = apuntes.reduce((a, x) => a + x.amount, 0);

      expect(suma).toBe(0);
    });

    it('y el registro enseña lo pedido Y lo descontado, sin esconder el suelo', async () => {
      const user = await conCreditos('debito-registro', 10);
      await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 500, reason: 'Se pide más de lo que hay' })
        .expect(200);

      const [registro] = await traza(user.id, 'ADMIN_CREDIT_DEBIT');
      expect(registro.after).toMatchObject({ requested: 500, debited: 10 });
    });

    it('sin motivo, se rechaza', async () => {
      const user = await conCreditos('debito-sin-motivo', 50);

      await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 10 })
        .expect(400);
    });

    it('sobre un saldo ya a cero se rechaza en vez de apuntar un movimiento vacío', async () => {
      const { user } = await crearUsuario('debito-vacio');
      await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });

      await request(server())
        .post(`/api/admin/billing/users/${user.id}/credits/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 5, reason: 'No hay nada que quitar' })
        .expect(400);
    });

    it('los bumps tienen su propio débito, con el mismo suelo', async () => {
      const { user } = await crearUsuario('debito-bumps');
      await request(server())
        .post(`/api/admin/billing/users/${user.id}/bumps`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 4, reason: MOTIVO })
        .expect(200);

      const res = await request(server())
        .post(`/api/admin/billing/users/${user.id}/bumps/debit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 99, reason: 'Corrección' });

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(0);
      expect(res.body.debitedAmount).toBe(4);
    });
  });

  // ── Permisos ──────────────────────────────────────────────────────────────

  describe('permisos — TODAS son ADMIN', () => {
    it.each([
      ['conceder Pro', 'pro', { expiresAt: new Date(Date.now() + 8.64e7).toISOString(), reason: 'x'.repeat(6) }],
      ['revocar Pro', 'pro/revoke', { reason: 'x'.repeat(6) }],
      ['dar bumps', 'bumps', { amount: 5, reason: 'x'.repeat(6) }],
      ['quitar créditos', 'credits/debit', { amount: 5, reason: 'x'.repeat(6) }],
      ['quitar bumps', 'bumps/debit', { amount: 5, reason: 'x'.repeat(6) }],
    ])('un MODERATOR no puede %s → 403', async (_nombre, ruta, body) => {
      // Dar o quitar valor no es moderar. El reparto lo fija el @MinRole(ADMIN)
      // de la clase, igual que para `grantCredits`.
      const { user } = await crearUsuario(`perm-${ruta.replace(/\//g, '-')}`);

      await request(server())
        .post(`/api/admin/billing/users/${user.id}/${ruta}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send(body)
        .expect(403);
    });

    it('sin token, 401', async () => {
      const { user } = await crearUsuario('perm-anon');

      await request(server())
        .post(`/api/admin/billing/users/${user.id}/pro`)
        .send({ expiresAt: enUnMes(), reason: MOTIVO })
        .expect(401);
    });
  });
});
