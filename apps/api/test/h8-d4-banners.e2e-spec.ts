/**
 * H8 Bloque D fase 4 — Banners de difusión (e2e)
 *
 * Presentación, sin dinero ni concurrencia — cierra el Bloque D. Cubre:
 * admin CRUD (crear/editar/listar, ADMIN-only, AuditLog), y la lógica pública
 * getActiveBanners() por ubicación (varios banners activos conviven, sin la
 * restricción de no-solapamiento de Campaign).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
  endpoint = '/api/auth/login',
): Promise<string> {
  const res = await request(app.getHttpServer()).post(endpoint).send({ email, password });
  return res.body.accessToken as string;
}

describe('H8 Bloque D fase 4 — Banners (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  // Muy en el futuro para "upcoming"/vigentes de esta suite, sin colisión con otras.
  function window(offsetDays: number, durationDays = 5) {
    const base = Date.now() + 600 * 24 * 60 * 60 * 1000;
    return {
      startsAt: new Date(base + offsetDays * 86_400_000).toISOString(),
      endsAt: new Date(base + (offsetDays + durationDays) * 86_400_000).toISOString(),
    };
  }

  // Ventana que YA está vigente ahora mismo (para probar el endpoint público).
  function liveWindow(durationDays = 5) {
    return {
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + durationDays * 86_400_000).toISOString(),
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    await Promise.all([
      prisma.user.create({
        data: {
          email: 'h8d4-admin@example.com',
          name: 'H8D4 Admin',
          slug: 'h8d4-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d4-user@example.com',
          name: 'H8D4 User',
          slug: 'h8d4-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d4-mod@example.com',
          name: 'H8D4 Moderator',
          slug: 'h8d4-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
    ]);

    [adminToken, userToken, moderatorToken] = await Promise.all([
      loginUser(app, 'h8d4-admin@example.com', 'Test1234!', '/api/auth/admin-login'),
      loginUser(app, 'h8d4-user@example.com', 'Test1234!'),
      loginUser(app, 'h8d4-mod@example.com', 'Test1234!'),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('Auth', () => {
    it('GET /api/admin/banners sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/banners').expect(401);
    });

    it('GET /api/admin/banners como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/banners')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    // ROLES R2 — estos dos casos decían «ADMIN-only, como campañas/cupones». Ya
    // no se agrupan así: los banners bajan hasta EDITOR (son pieza de la portada)
    // mientras que campañas y cupones se quedan en MODERATOR. Un MODERATOR
    // satisface el piso de EDITOR por la escalera, así que entra.
    it('GET /api/admin/banners como MODERATOR → 200 (el piso es EDITOR desde R2)', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/banners')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
    });

    it('POST /api/admin/banners como MODERATOR → 201', async () => {
      const w = window(0);
      const res = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ title: 'mod', text: 'mod', placements: ['HOME'], ...w })
        .expect(201);

      // Se limpia por Prisma (no hay endpoint de borrado de banners): los casos
      // de abajo cuentan banners activos por placement y este no debe descuadrarlos.
      await prisma.banner.delete({ where: { id: res.body.id as string } });
    });

    it('GET /api/banners (público) sin auth → 200', async () => {
      await request(app.getHttpServer()).get('/api/banners?placement=HOME').expect(200);
    });
  });

  // ── Crear ────────────────────────────────────────────────────────────────────

  describe('Crear banner', () => {
    it('válido con un placement → 201, AuditLog BANNER_CREATE', async () => {
      const w = window(0);
      const res = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Créditos gratis',
          text: '¡+50 créditos esta semana!',
          placements: ['HOME'],
          ...w,
        })
        .expect(201);

      expect(res.body.title).toBe('Créditos gratis');
      expect(res.body.placements).toEqual(['HOME']);
      expect(res.body.variant).toBe('INFO');
      expect(res.body.shareable).toBe(false);
      expect(res.body.active).toBe(true);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'BANNER_CREATE', resourceId: res.body.id },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.resourceType).toBe('Banner');
    });

    it('con varios placements + shareable + variant PROMO → 201', async () => {
      const w = window(10);
      const res = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Promo doble',
          text: 'Aparece en home y en mis-anuncios',
          placements: ['HOME', 'MIS_ANUNCIOS'],
          variant: 'PROMO',
          shareable: true,
          shareText: 'Mira esta promo',
          linkUrl: '/planes',
          linkText: 'Ver planes',
          ...w,
        })
        .expect(201);

      expect(res.body.placements.sort()).toEqual(['HOME', 'MIS_ANUNCIOS'].sort());
      expect(res.body.variant).toBe('PROMO');
      expect(res.body.shareable).toBe(true);
      expect(res.body.shareText).toBe('Mira esta promo');
      expect(res.body.linkUrl).toBe('/planes');
    });

    it('placements vacío → 400', async () => {
      const w = window(20);
      await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'x', text: 'x', placements: [], ...w })
        .expect(400);
    });

    it('placements con valor inválido → 400', async () => {
      const w = window(30);
      await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'x', text: 'x', placements: ['NOPE'], ...w })
        .expect(400);
    });

    it('endsAt <= startsAt → 400', async () => {
      const w = window(40);
      await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'x',
          text: 'x',
          placements: ['HOME'],
          startsAt: w.endsAt,
          endsAt: w.startsAt,
        })
        .expect(400);
    });
  });

  // ── Editar ───────────────────────────────────────────────────────────────────

  describe('Editar banner', () => {
    it('desactivar registra BANNER_DEACTIVATE; activar registra BANNER_ACTIVATE', async () => {
      const w = window(100);
      const created = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'toggle', text: 'toggle', placements: ['HOME'], ...w })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/banners/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const deactivateLog = await prisma.auditLog.findFirst({
        where: { action: 'BANNER_DEACTIVATE', resourceId: created.body.id },
      });
      expect(deactivateLog).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/banners/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(200);

      const activateLog = await prisma.auditLog.findFirst({
        where: { action: 'BANNER_ACTIVATE', resourceId: created.body.id },
      });
      expect(activateLog).not.toBeNull();
    });

    it('edita título, texto, placements y linkUrl — TODO editable (a diferencia de Coupon.code)', async () => {
      const w = window(110);
      const created = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'original', text: 'original text', placements: ['HOME'], ...w })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/banners/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'editado',
          text: 'texto editado',
          placements: ['MIS_ANUNCIOS'],
          linkUrl: '/mis-creditos',
        })
        .expect(200);

      expect(res.body.title).toBe('editado');
      expect(res.body.text).toBe('texto editado');
      expect(res.body.placements).toEqual(['MIS_ANUNCIOS']);
      expect(res.body.linkUrl).toBe('/mis-creditos');

      const editLog = await prisma.auditLog.findFirst({
        where: { action: 'BANNER_EDIT', resourceId: created.body.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(editLog).not.toBeNull();
    });

    it('placements a array vacío en PATCH → 400', async () => {
      const w = window(120);
      const created = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'x', text: 'x', placements: ['HOME'], ...w })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/banners/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ placements: [] })
        .expect(400);
    });

    it('PATCH a banner inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/banners/xxxxxxxx-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(404);
    });
  });

  // ── Listado admin ────────────────────────────────────────────────────────────

  describe('Listado admin', () => {
    it('devuelve status derivado (upcoming|live|ended)', async () => {
      const upcoming = window(200, 5);
      const created = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'futuro', text: 'futuro', placements: ['HOME'], ...upcoming })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/banners?perPage=200')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const item = (res.body.items as Array<Record<string, unknown>>).find(
        (b) => b.id === created.body.id,
      );
      expect(item).toBeDefined();
      expect(item!.status).toBe('upcoming');
    });

    it('filtra por placement y active', async () => {
      const w = window(300);
      await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'solo mis-anuncios inactivo',
          text: 'x',
          placements: ['MIS_ANUNCIOS'],
          active: false,
          ...w,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/banners?placement=MIS_ANUNCIOS&active=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(
        (res.body.items as Array<{ placements: string[]; active: boolean }>).every(
          (b) => b.placements.includes('MIS_ANUNCIOS') && b.active === false,
        ),
      ).toBe(true);
    });
  });

  // ── Lógica pública de banners activos ───────────────────────────────────────

  describe('GET /banners (público) — getActiveBanners', () => {
    it('devuelve solo banners active + vigentes ahora + con el placement pedido', async () => {
      const live = liveWindow();
      const [homeLive, homeUpcoming, homeInactive, otherPlacement] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'home-live', text: 'x', placements: ['HOME'], ...live }),
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'home-upcoming', text: 'x', placements: ['HOME'], ...window(400) }),
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'home-inactive',
            text: 'x',
            placements: ['HOME'],
            active: false,
            ...live,
          }),
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'solo-mis-anuncios', text: 'x', placements: ['MIS_ANUNCIOS'], ...live }),
      ]);

      const res = await request(app.getHttpServer()).get('/api/banners?placement=HOME').expect(200);

      const ids = (res.body as Array<{ id: string }>).map((b) => b.id);
      expect(ids).toContain(homeLive.body.id);
      expect(ids).not.toContain(homeUpcoming.body.id);
      expect(ids).not.toContain(homeInactive.body.id);
      expect(ids).not.toContain(otherPlacement.body.id);
    });

    it('varios banners activos en el mismo placement conviven — se devuelven todos', async () => {
      const live = liveWindow();
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'conviven-a', text: 'x', placements: ['MIS_ANUNCIOS'], ...live }),
        request(app.getHttpServer())
          .post('/api/admin/banners')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'conviven-b', text: 'x', placements: ['MIS_ANUNCIOS'], ...live }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/banners?placement=MIS_ANUNCIOS')
        .expect(200);

      const ids = (res.body as Array<{ id: string }>).map((banner) => banner.id);
      expect(ids).toContain(a.body.id);
      expect(ids).toContain(b.body.id);
    });

    it('banner con ambos placements aparece en HOME y en MIS_ANUNCIOS', async () => {
      const live = liveWindow();
      const created = await request(app.getHttpServer())
        .post('/api/admin/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'ambos', text: 'x', placements: ['HOME', 'MIS_ANUNCIOS'], ...live })
        .expect(201);

      const [home, misAnuncios] = await Promise.all([
        request(app.getHttpServer()).get('/api/banners?placement=HOME'),
        request(app.getHttpServer()).get('/api/banners?placement=MIS_ANUNCIOS'),
      ]);

      expect((home.body as Array<{ id: string }>).map((x) => x.id)).toContain(created.body.id);
      expect((misAnuncios.body as Array<{ id: string }>).map((x) => x.id)).toContain(
        created.body.id,
      );
    });

    it('placement inválido en query → 400', async () => {
      await request(app.getHttpServer()).get('/api/banners?placement=NOPE').expect(400);
    });
  });
});
