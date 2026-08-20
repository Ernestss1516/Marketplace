/**
 * FICHA DE USUARIO — RÁFAGA U3: EL GATE DEL DINERO, POR LA API.
 *
 * LA BARRERA (D-3): **un MODERATOR no puede ver el saldo de un usuario, ni
 * siquiera pidiéndolo a mano.**
 *
 * Es la mitad que importa del gate. Que la pantalla no pinte el bloque es
 * cómodo; que el dato NO SALGA del servidor es lo que lo hace real. Por eso se
 * comprueba aquí y no sólo en el navegador:
 *
 *   · `GET /admin/users/:id` (MODERATOR) **no lleva dinero** — ni saldo, ni
 *     bumps, ni entitlements, ni transacciones;
 *   · `GET /admin/billing/users/:id` (el que sí lo lleva) responde **403** a un
 *     MODERATOR.
 *
 * El reparto no es nuevo: `/admin/facturacion` ya era ADMIN y `/admin/usuarios`
 * MODERATOR. Lo que U3 tenía que evitar es ensancharlo de rebote al juntar las
 * dos vistas en una ficha.
 *
 * Ver docs/diseno-ficha-usuario.md §4.1 y §7 (D-3).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Ficha de usuario U3 — el gate del dinero (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let moderatorToken: string;
  let sujetoId: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [sujeto] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'u3-sujeto@example.com', name: 'U3 Sujeto', slug: 'u3-sujeto',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'u3-admin@example.com', name: 'U3 Admin', slug: 'u3-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'u3-mod@example.com', name: 'U3 Mod', slug: 'u3-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
    ]);
    sujetoId = sujeto.id;

    // Un saldo bien visible, para que «no aparece» signifique algo.
    await prisma.wallet.create({
      data: { userId: sujetoId, balance: 4242, bumpBalance: 77 },
    });

    const login = (email: string) =>
      request(server()).post('/api/auth/admin-login').send({ email, password: 'Test1234!' });
    adminToken = (await login('u3-admin@example.com')).body.accessToken as string;
    moderatorToken = (await login('u3-mod@example.com')).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── LA BARRERA ────────────────────────────────────────────────────────────

  describe('LA BARRERA — el dinero no sale por la puerta del MODERATOR', () => {
    it('el detalle que ve un MODERATOR NO contiene el saldo por ninguna parte', async () => {
      const res = await request(server())
        .get(`/api/admin/users/${sujetoId}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      // Se busca en la respuesta ENTERA serializada, no campo a campo: si algún
      // día alguien añade el monedero a este endpoint «porque hace falta en la
      // ficha», esto lo caza aunque lo meta anidado.
      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toContain('4242');
      expect(cuerpo).not.toContain('bumpBalance');
      expect(cuerpo).not.toContain('wallet');
      expect(cuerpo).not.toContain('entitlements');
      expect(cuerpo).not.toContain('transactions');
    });

    it('y el endpoint que SÍ lo lleva le responde 403', async () => {
      const res = await request(server())
        .get(`/api/admin/billing/users/${sujetoId}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(403);
    });

    it('un ADMIN sí ve el saldo, por su endpoint', async () => {
      const res = await request(server())
        .get(`/api/admin/billing/users/${sujetoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.wallet.balance).toBe(4242);
      expect(res.body.wallet.bumpBalance).toBe(77);
    });
  });

  // ── El resto de la ficha SÍ es del moderador ──────────────────────────────

  describe('lo demás sí lo ve un MODERATOR — el gate es del dinero, no de la ficha', () => {
    it('ve al usuario y lo relacionado', async () => {
      const res = await request(server())
        .get(`/api/admin/users/${sujetoId}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('u3-sujeto@example.com');
      expect(res.body).toHaveProperty('listings');
      expect(res.body).toHaveProperty('reviewsReceived');
      expect(res.body).toHaveProperty('reviewsAuthored');
      expect(res.body).toHaveProperty('reportsReceived');
      expect(res.body).toHaveProperty('reportsMade');
      expect(res.body).toHaveProperty('tickets');
      expect(res.body).toHaveProperty('auditLogs');
    });

    it('y ve el HECHO de ser Pro, que es información pública', async () => {
      // La insignia Pro está en el perfil público de cualquier vendedor, así que
      // ocultársela al moderador no protegería nada. Lo que no ve es la
      // PROCEDENCIA ni el vencimiento, que sí describen una relación comercial.
      const res = await request(server())
        .get(`/api/admin/users/${sujetoId}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.isPro).toBe(false);

      await prisma.entitlement.create({
        data: {
          userId: sujetoId,
          type: 'PRO_SUBSCRIPTION',
          subscriptionId: null,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const conPro = await request(server())
        .get(`/api/admin/users/${sujetoId}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(conPro.body.isPro).toBe(true);
      // Pero sigue sin llevar la procedencia ni la fecha.
      expect(JSON.stringify(conPro.body)).not.toContain('subscriptionId');
    });

    it('un EDITOR no entra en la ficha (la sección es MODERATOR)', async () => {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      await prisma.user.create({
        data: {
          email: 'u3-editor@example.com', name: 'U3 Editor', slug: 'u3-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      });
      const editorToken = (
        await request(server())
          .post('/api/auth/admin-login')
          .send({ email: 'u3-editor@example.com', password: 'Test1234!' })
      ).body.accessToken as string;

      await request(server())
        .get(`/api/admin/users/${sujetoId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);
    });
  });

  // ── La procedencia, para el ADMIN ─────────────────────────────────────────

  describe('la procedencia del Pro, derivada', () => {
    it('el detalle de facturación lleva `subscriptionId` para poder distinguirla', async () => {
      const res = await request(server())
        .get(`/api/admin/billing/users/${sujetoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const pro = (res.body.entitlements as { type: string; subscriptionId: string | null }[])
        .filter((e) => e.type === 'PRO_SUBSCRIPTION');

      expect(pro.length).toBeGreaterThan(0);
      // El concedido a mano no tiene suscripción: ahí vive la procedencia, sin
      // columna `source`.
      expect(pro.some((e) => e.subscriptionId === null)).toBe(true);
    });
  });
});
