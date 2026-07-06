/**
 * H8 Bloque D fase 3b — Admin CRUD de cupones (e2e)
 *
 * Sin lógica de concurrencia nueva (ya resuelta y probada en fase 3a,
 * h8-d3a-coupons.e2e-spec.ts). Esto cubre gestión de catálogo: crear, editar,
 * listar, validación cruzada de recompensa, ADMIN-only, AuditLog.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('H8 Bloque D fase 3b — Admin coupons CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  function window(offsetDays: number, durationDays = 5) {
    const base = Date.now() + 500 * 24 * 60 * 60 * 1000; // muy en el futuro, sin colisión con fase 3a
    return {
      startsAt: new Date(base + offsetDays * 86_400_000).toISOString(),
      endsAt: new Date(base + (offsetDays + durationDays) * 86_400_000).toISOString(),
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const [admin, regularUser, moderator] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'h8d3b-admin@example.com',
          name: 'H8D3B Admin',
          slug: 'h8d3b-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d3b-user@example.com',
          name: 'H8D3B User',
          slug: 'h8d3b-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d3b-mod@example.com',
          name: 'H8D3B Moderator',
          slug: 'h8d3b-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
    ]);
    void admin;
    void regularUser;
    void moderator;

    [adminToken, userToken, moderatorToken] = await Promise.all([
      loginUser(app, 'h8d3b-admin@example.com', 'Test1234!'),
      loginUser(app, 'h8d3b-user@example.com', 'Test1234!'),
      loginUser(app, 'h8d3b-mod@example.com', 'Test1234!'),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('Auth', () => {
    it('GET /api/admin/coupons sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/coupons').expect(401);
    });

    it('GET /api/admin/coupons como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/coupons')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('GET /api/admin/coupons como MODERATOR → 403 (ADMIN-only, como campañas)', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/coupons')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);
    });

    it('POST /api/admin/coupons como MODERATOR → 403', async () => {
      const w = window(0);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({
          code: `MOD-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 10,
          ...w,
        })
        .expect(403);
    });
  });

  // ── Crear ────────────────────────────────────────────────────────────────────

  describe('Crear cupón', () => {
    it('CREDITS válido → 201, code normalizado a MAYÚSCULAS', async () => {
      const w = window(0);
      const res = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `verano-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 50,
          ...w,
        })
        .expect(201);

      expect(res.body.code).toBe(res.body.code.toUpperCase());
      expect(res.body.rewardType).toBe('CREDITS');
      expect(res.body.creditAmount).toBe(50);
      expect(res.body.featuredDurationDays).toBeNull();
      expect(res.body.redemptionCount).toBe(0);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'COUPON_CREATE', resourceId: res.body.id },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.resourceType).toBe('Coupon');
    });

    it('FEATURED válido → 201', async () => {
      const w = window(10);
      const res = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `feat-${Date.now()}`,
          rewardType: 'FEATURED',
          featuredDurationDays: 14,
          ...w,
        })
        .expect(201);

      expect(res.body.rewardType).toBe('FEATURED');
      expect(res.body.featuredDurationDays).toBe(14);
      expect(res.body.creditAmount).toBeNull();
    });

    it('CREDITS sin creditAmount → 400', async () => {
      const w = window(20);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `bad-${Date.now()}`, rewardType: 'CREDITS', ...w })
        .expect(400);
    });

    it('FEATURED sin featuredDurationDays → 400', async () => {
      const w = window(30);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `bad2-${Date.now()}`, rewardType: 'FEATURED', ...w })
        .expect(400);
    });

    it('CREDITS con featuredDurationDays también enviado → 400 (prohibido)', async () => {
      const w = window(40);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `bad3-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 10,
          featuredDurationDays: 7,
          ...w,
        })
        .expect(400);
    });

    it('endsAt <= startsAt → 400', async () => {
      const w = window(50);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `bad4-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 10,
          startsAt: w.endsAt,
          endsAt: w.startsAt,
        })
        .expect(400);
    });

    it('código duplicado → 409 COUPON_CODE_TAKEN', async () => {
      const code = `DUP-${Date.now()}`;
      const w1 = window(60);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, rewardType: 'CREDITS', creditAmount: 10, ...w1 })
        .expect(201);

      const w2 = window(70);
      const res = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: code.toLowerCase(), rewardType: 'CREDITS', creditAmount: 20, ...w2 })
        .expect(409);

      expect(res.body.message?.code ?? res.body.code).toBe('COUPON_CODE_TAKEN');
    });
  });

  // ── Editar ───────────────────────────────────────────────────────────────────

  describe('Editar cupón', () => {
    it('desactivar registra COUPON_DEACTIVATE; activar registra COUPON_ACTIVATE', async () => {
      const w = window(100);
      const created = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `toggle-${Date.now()}`, rewardType: 'CREDITS', creditAmount: 10, ...w })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const deactivateLog = await prisma.auditLog.findFirst({
        where: { action: 'COUPON_DEACTIVATE', resourceId: created.body.id },
      });
      expect(deactivateLog).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(200);

      const activateLog = await prisma.auditLog.findFirst({
        where: { action: 'COUPON_ACTIVATE', resourceId: created.body.id },
      });
      expect(activateLog).not.toBeNull();
    });

    it('cambiar creditAmount de un cupón CREDITS → 200, valor actualizado', async () => {
      const w = window(110);
      const created = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `editamt-${Date.now()}`, rewardType: 'CREDITS', creditAmount: 10, ...w })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ creditAmount: 99 })
        .expect(200);

      expect(res.body.creditAmount).toBe(99);
    });

    it('enviar featuredDurationDays a un cupón CREDITS → 400', async () => {
      const w = window(120);
      const created = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `editbad-${Date.now()}`, rewardType: 'CREDITS', creditAmount: 10, ...w })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ featuredDurationDays: 7 })
        .expect(400);
    });

    it('poner maxRedemptions a null quita el límite (ilimitado)', async () => {
      const w = window(130);
      const created = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `unlimited-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 10,
          maxRedemptions: 5,
          ...w,
        })
        .expect(201);
      expect(created.body.maxRedemptions).toBe(5);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxRedemptions: null })
        .expect(200);

      expect(res.body.maxRedemptions).toBeNull();
    });

    it('PATCH a cupón inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/coupons/xxxxxxxx-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(404);
    });
  });

  // ── Listado ──────────────────────────────────────────────────────────────────

  describe('Listado', () => {
    it('devuelve status derivado (upcoming|live|ended) y usos/límite', async () => {
      const upcoming = window(200, 5);
      const created = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `list-upcoming-${Date.now()}`,
          rewardType: 'CREDITS',
          creditAmount: 10,
          maxRedemptions: 3,
          ...upcoming,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/coupons?perPage=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const item = (res.body.items as Array<Record<string, unknown>>).find(
        (c) => c.id === created.body.id,
      );
      expect(item).toBeDefined();
      expect(item!.status).toBe('upcoming');
      expect(item!.maxRedemptions).toBe(3);
      expect(item!.redemptionCount).toBe(0);
    });

    it('filtra por rewardType y active', async () => {
      const w = window(300);
      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `list-filter-${Date.now()}`,
          rewardType: 'FEATURED',
          featuredDurationDays: 7,
          active: false,
          ...w,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/coupons?rewardType=FEATURED&active=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(
        (res.body.items as Array<{ rewardType: string; active: boolean }>).every(
          (c) => c.rewardType === 'FEATURED' && c.active === false,
        ),
      ).toBe(true);
    });
  });
});
