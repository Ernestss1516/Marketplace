/**
 * H6.6 — Anuncios patrocinados (e2e)
 *
 * Banners publicitarios EXTERNOS gestionados por admin (no Listings del
 * marketplace), inyectados en /search por categoría (o su padre) SOLO en
 * página 1. Cubre: admin CRUD (ADMIN-only, AuditLog, sin DELETE), subida de
 * imagen (molde uploadAvatar — no toca ListingImage), e inyección en
 * búsqueda con caché Redis (incluida su invalidación).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';
import { RedisService } from 'src/infra/redis/redis.service';

// ADMIN solo puede entrar por /auth/admin-login — /auth/login lo rechaza (ver
// AuthService.login/adminLogin). endpoint lo pasa explícito el llamante.
async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
  endpoint = '/api/auth/login',
): Promise<string> {
  const res = await request(app.getHttpServer()).post(endpoint).send({ email, password });
  return res.body.accessToken as string;
}

// Minimal 1×1 JPEG in memory — no filesystem dependency (same fixture as media.e2e-spec.ts).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
  'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
  'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
  'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
  'base64',
);

describe('H6.6 Bloque C — Sponsored Ads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let redis: RedisService;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;
  let sellerToken: string;

  let vehiculosId: string;
  let cochesId: string;
  let movilesId: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  // Muy en el futuro, sin colisión con otras suites.
  function window(offsetDays: number, durationDays = 5) {
    const base = Date.now() + 700 * 24 * 60 * 60 * 1000;
    return {
      startsAt: new Date(base + offsetDays * 86_400_000).toISOString(),
      endsAt: new Date(base + (offsetDays + durationDays) * 86_400_000).toISOString(),
    };
  }

  function createAd(token: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/admin/sponsored-ads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageUrl: 'https://example.com/ad.jpg',
        title: 'Anuncio de prueba',
        description: 'Descripción de prueba',
        targetUrl: 'https://example.com/promo',
        categoryId: vehiculosId,
        ...overrides,
      });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    redis = app.get(RedisService);

    await cleanDb(prisma);
    await resetMeili(meili);

    const vehiculos = await prisma.category.findUniqueOrThrow({ where: { slug: 'vehiculos' } });
    const coches = await prisma.category.findUniqueOrThrow({ where: { slug: 'coches' } });
    const moviles = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    vehiculosId = vehiculos.id;
    cochesId = coches.id;
    movilesId = moviles.id;

    // Cachés de ejecuciones anteriores (mismos slugs, sin TTL expirado aún) no
    // deben filtrarse a esta pasada — ver feedback_ci_verde_repetido.
    await redis.client.del(
      'sponsored-ad:search:vehiculos',
      'sponsored-ad:search:coches',
      'sponsored-ad:search:moviles',
    );

    await Promise.all([
      prisma.user.create({
        data: {
          email: 'h66-admin@example.com',
          name: 'H66 Admin',
          slug: 'h66-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h66-user@example.com',
          name: 'H66 User',
          slug: 'h66-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h66-mod@example.com',
          name: 'H66 Moderator',
          slug: 'h66-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h66-seller@example.com',
          name: 'H66 Seller',
          slug: 'h66-seller',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      }),
    ]);

    [adminToken, userToken, moderatorToken, sellerToken] = await Promise.all([
      loginUser(app, 'h66-admin@example.com', 'Test1234!', '/api/auth/admin-login'),
      loginUser(app, 'h66-user@example.com', 'Test1234!'),
      loginUser(app, 'h66-mod@example.com', 'Test1234!'),
      loginUser(app, 'h66-seller@example.com', 'Test1234!'),
    ]);
  }, 60_000);

  afterAll(async () => {
    // SponsoredAd no cuelga de User (a diferencia de Listing/AuditLog), así que
    // cleanDb() (TRUNCATE "User" CASCADE) no lo alcanza — sin este cleanup,
    // los patrocinados con imageUrl de prueba (https://example.com/...)
    // quedarían huérfanos en la BD compartida y romperían next/image (host no
    // configurado) en cualquier otra sesión que abra /admin/sponsored-ads
    // contra esta misma base (Playwright incluido).
    await prisma.sponsoredAd.deleteMany({ where: { categoryId: { in: [vehiculosId, cochesId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('Auth', () => {
    it('GET /api/admin/sponsored-ads sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/sponsored-ads').expect(401);
    });

    it('GET /api/admin/sponsored-ads como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/sponsored-ads')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('GET /api/admin/sponsored-ads como MODERATOR → 403 (ADMIN-only)', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/sponsored-ads')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);
    });

    it('POST /api/admin/sponsored-ads/upload-image como USER → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/sponsored-ads/upload-image')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', TINY_JPEG, { filename: 'ad.jpg', contentType: 'image/jpeg' })
        .expect(403);
    });
  });

  // ── Subida de imagen ─────────────────────────────────────────────────────────

  describe('POST /api/admin/sponsored-ads/upload-image', () => {
    it('archivo no-imagen → 422', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/sponsored-ads/upload-image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
        .expect(422);
    });

    it('sin archivo → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/sponsored-ads/upload-image')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('admin autenticado → 201 { url } bajo sponsored/, y NO crea ListingImage', async () => {
      const countBefore = await prisma.listingImage.count();

      const res = await request(app.getHttpServer())
        .post('/api/admin/sponsored-ads/upload-image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', TINY_JPEG, { filename: 'ad.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(res.body).toHaveProperty('url');
      expect(res.body.url).toMatch(/sponsored\//);

      const countAfter = await prisma.listingImage.count();
      expect(countAfter).toBe(countBefore);
    });
  });

  // ── Crear ────────────────────────────────────────────────────────────────────

  describe('Crear patrocinado', () => {
    it('válido → 201, AuditLog SPONSORED_AD_CREATE', async () => {
      const res = await createAd(adminToken, { title: 'Crear válido' }).expect(201);

      expect(res.body.title).toBe('Crear válido');
      expect(res.body.categoryId).toBe(vehiculosId);
      expect(res.body.active).toBe(true);
      expect(res.body.order).toBe(0);
      expect(res.body.startsAt).toBeNull();
      expect(res.body.endsAt).toBeNull();

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'SPONSORED_AD_CREATE', resourceId: res.body.id },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.resourceType).toBe('SponsoredAd');
    });

    it('targetUrl no es una URL válida → 400', async () => {
      await createAd(adminToken, { targetUrl: 'no-es-una-url' }).expect(400);
    });

    it('categoryId inexistente → 404', async () => {
      await createAd(adminToken, { categoryId: 'xxxxxxxx-0000-0000-0000-000000000000' }).expect(404);
    });

    it('endsAt <= startsAt → 400', async () => {
      const w = window(0);
      await createAd(adminToken, { startsAt: w.endsAt, endsAt: w.startsAt }).expect(400);
    });

    it('como MODERATOR → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/sponsored-ads')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({
          imageUrl: 'https://example.com/ad.jpg',
          title: 'x',
          description: 'x',
          targetUrl: 'https://example.com',
          categoryId: vehiculosId,
        })
        .expect(403);
    });
  });

  // ── Editar ───────────────────────────────────────────────────────────────────

  describe('Editar patrocinado', () => {
    it('desactivar registra SPONSORED_AD_DEACTIVATE; activar registra SPONSORED_AD_ACTIVATE', async () => {
      const created = await createAd(adminToken, { title: 'toggle' }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/sponsored-ads/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const deactivateLog = await prisma.auditLog.findFirst({
        where: { action: 'SPONSORED_AD_DEACTIVATE', resourceId: created.body.id },
      });
      expect(deactivateLog).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/sponsored-ads/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(200);

      const activateLog = await prisma.auditLog.findFirst({
        where: { action: 'SPONSORED_AD_ACTIVATE', resourceId: created.body.id },
      });
      expect(activateLog).not.toBeNull();
    });

    it('edita título, descripción y targetUrl — TODO editable', async () => {
      const created = await createAd(adminToken, { title: 'original' }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/sponsored-ads/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'editado', description: 'desc editada', targetUrl: 'https://ejemplo.com/otro' })
        .expect(200);

      expect(res.body.title).toBe('editado');
      expect(res.body.description).toBe('desc editada');
      expect(res.body.targetUrl).toBe('https://ejemplo.com/otro');

      const editLog = await prisma.auditLog.findFirst({
        where: { action: 'SPONSORED_AD_EDIT', resourceId: created.body.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(editLog).not.toBeNull();
    });

    it('PATCH a patrocinado inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/sponsored-ads/xxxxxxxx-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(404);
    });
  });

  // ── Listado admin ────────────────────────────────────────────────────────────

  describe('Listado admin', () => {
    it('devuelve status derivado (upcoming|live|ended)', async () => {
      const upcoming = window(200, 5);
      const created = await createAd(adminToken, { title: 'futuro', ...upcoming }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/sponsored-ads?perPage=200')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const item = (res.body.items as Array<Record<string, unknown>>).find(
        (a) => a.id === created.body.id,
      );
      expect(item).toBeDefined();
      expect(item!.status).toBe('upcoming');
    });
  });

  // ── Inyección en búsqueda ────────────────────────────────────────────────────

  describe('Inyección en /search (H6.6)', () => {
    beforeEach(async () => {
      // Los patrocinados creados en un test de este bloque no deben filtrarse
      // al siguiente (comparten categoría 'vehiculos'/'coches').
      await prisma.sponsoredAd.deleteMany({ where: { categoryId: { in: [vehiculosId, cochesId] } } });
      await redis.client.del(
        'sponsored-ad:search:vehiculos',
        'sponsored-ad:search:coches',
        'sponsored-ad:search:moviles',
      );
    });

    it('categoría sin patrocinado → hits sin __sponsored', async () => {
      const res = await request(app.getHttpServer()).get('/api/search?category=moviles&page=1').expect(200);
      expect(res.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);
    });

    it('patrocinado en categoría padre (vehiculos) aparece al buscar la hija (coches), página 1', async () => {
      const created = await createAd(adminToken, {
        title: 'Patrocinado vehículos',
        categoryId: vehiculosId,
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);

      const sponsored = res.body.hits.find((h: Record<string, unknown>) => h.__sponsored);
      expect(sponsored).toBeDefined();
      expect(sponsored.id).toBe(created.body.id);
      expect(sponsored.title).toBe('Patrocinado vehículos');
      expect(sponsored.targetUrl).toBe('https://example.com/promo');

      await request(app.getHttpServer())
        .patch(`/api/admin/sponsored-ads/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);
    });

    it('página 2 NO inyecta patrocinado', async () => {
      await createAd(adminToken, { title: 'p2' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=2')
        .expect(200);

      expect(res.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);
    });

    it('patrocinado inactivo no aparece', async () => {
      await createAd(adminToken, { title: 'inactivo', active: false }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);

      expect(res.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);
    });

    it('patrocinado fuera de la ventana de fechas (upcoming) no aparece', async () => {
      const upcoming = window(300, 5);
      await createAd(adminToken, { title: 'futuro-inyeccion', ...upcoming }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);

      expect(res.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);
    });

    it('caché Redis: invalidación inmediata al crear (no espera al TTL)', async () => {
      // 1) Sin patrocinados: la respuesta se cachea como "sin anuncio".
      const before = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);
      expect(before.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);

      // 2) Crear un patrocinado para 'coches' debe invalidar esa entrada de caché...
      const created = await createAd(adminToken, {
        title: 'cache-invalidation',
        categoryId: cochesId,
      }).expect(201);

      // 3) ...así que aparece de inmediato, sin esperar el TTL de 5 min.
      const after = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);
      const sponsored = after.body.hits.find((h: Record<string, unknown>) => h.__sponsored);
      expect(sponsored).toBeDefined();
      expect(sponsored.id).toBe(created.body.id);

      // 4) Desactivarlo también debe invalidar de inmediato.
      await request(app.getHttpServer())
        .patch(`/api/admin/sponsored-ads/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const afterDeactivate = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);
      expect(afterDeactivate.body.hits.some((h: Record<string, unknown>) => h.__sponsored)).toBe(false);
    });

    it('posición fija: con ≥3 anuncios reales, el patrocinado se inserta en el índice 3', async () => {
      // 3 anuncios ACTIVE reales en 'coches' + 1 patrocinado de 'vehiculos'.
      const listings = ['Coche patrocinado A', 'Coche patrocinado B', 'Coche patrocinado C'];
      const publishedIds: string[] = [];
      for (const title of listings) {
        const draft = await request(app.getHttpServer())
          .post('/api/listings')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            title,
            description: `Descripción de "${title}"`,
            price: 10_000,
            type: 'PRODUCT',
            priceType: 'FIXED',
            condition: 'GOOD',
            categoryId: cochesId,
            city: 'Madrid',
            province: 'Madrid',
            attributes: { year: 2022, km: 15_000, brand: 'Seat' },
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(`/api/listings/${draft.body.id}/publish`)
          .set('Authorization', `Bearer ${sellerToken}`)
          .expect(200);

        publishedIds.push(draft.body.id as string);
      }
      for (const id of publishedIds) {
        await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, id);
      }

      const created = await createAd(adminToken, { title: 'posicion-fija' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/search?category=coches&page=1')
        .expect(200);

      const index = (res.body.hits as Array<Record<string, unknown>>).findIndex(
        (h) => h.__sponsored === true,
      );
      expect(index).toBe(3);
      expect((res.body.hits[index] as Record<string, unknown>).id).toBe(created.body.id);
    }, 30_000);
  });
});
