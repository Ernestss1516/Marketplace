import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';

describe('Alerts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let ownerToken: string;
  let otherToken: string;
  let matchingListingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });

    await prisma.user.create({
      data: {
        email: 'alert-seller@example.com',
        name: 'Alert Seller',
        slug: 'alert-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const sellerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alert-seller@example.com', password: 'Test1234!' });
    const sellerToken = sellerLogin.body.accessToken as string;

    // A published listing that matches the alerts created below:
    // moviles, 300€ (within [100,500]), Madrid, brand=Apple (text), ram=8 (number).
    const createRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'iPhone para alertas',
        description: 'Descripción de prueba para el iPhone de alertas',
        price: 300,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId: category.id,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
        attributes: { brand: 'Apple', ram: 8 },
      })
      .expect(201);
    matchingListingId = createRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/listings/${matchingListingId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, matchingListingId);

    await prisma.user.create({
      data: {
        email: 'alert-owner@example.com',
        name: 'Alert Owner',
        slug: 'alert-owner',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alert-owner@example.com', password: 'Test1234!' });
    ownerToken = ownerLogin.body.accessToken as string;

    await prisma.user.create({
      data: {
        email: 'alert-other@example.com',
        name: 'Alert Other',
        slug: 'alert-other',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const otherLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alert-other@example.com', password: 'Test1234!' });
    otherToken = otherLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── auth guard ──────────────────────────────────────────────────────────────

  it('POST /api/alerts sin auth → 401', async () => {
    await request(app.getHttpServer()).post('/api/alerts').send({ name: 'x' }).expect(401);
  });

  it('GET /api/alerts sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/alerts').expect(401);
  });

  // ── crear + preview de coincidencias ─────────────────────────────────────────

  it('POST /api/alerts → 201, crea la alerta y devuelve {alert, matches} con el anuncio que encaja', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'iPhone en Madrid',
        categorySlug: 'moviles',
        minPrice: 100,
        maxPrice: 500,
        province: 'Madrid',
        attributes: { brand: 'Apple', ram: '8' },
      })
      .expect(201);

    expect(res.body.alert.name).toBe('iPhone en Madrid');
    expect(res.body.alert.categorySlug).toBe('moviles');
    expect(res.body.alert.active).toBe(true);
    expect(res.body.matches.totalHits).toBeGreaterThanOrEqual(1);
    expect(res.body.matches.hits.some((h: { id: string }) => h.id === matchingListingId)).toBe(true);
  });

  it('coacción de tipos: attributes numéricos se persisten como number, no string', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Coacción RAM', categorySlug: 'moviles', attributes: { ram: '8' } })
      .expect(201);

    const stored = await prisma.alert.findUniqueOrThrow({ where: { id: res.body.alert.id } });
    const attrs = stored.attributes as Record<string, unknown>;
    expect(attrs.ram).toBe(8);
    expect(typeof attrs.ram).toBe('number');
  });

  it('atributo no reconocido → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Atributo inválido', attributes: { doesNotExist: 'x' } })
      .expect(422);
  });

  // ── AUDITORÍA DE FILTROS — mismo cross-category leak que RÁFAGA 1 arregló en
  // /search, replicado aquí: un atributo que SÍ existe globalmente (de OTRA
  // categoría) pero no aplica a la categoría de la alerta debía ser aceptado
  // (201) antes de este fix — la alerta quedaba guardada con un criterio
  // imposible que ningún anuncio de "moviles" cumpliría jamás, sin avisar.
  // "km" vive en "vehiculos" (y se hereda en "coches") — nada que ver con "moviles".

  it('atributo de OTRA categoría (km, de "vehiculos") en una alerta de categorySlug=moviles → 422, ya no 201', async () => {
    await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Cross-category', categorySlug: 'moviles', attributes: { km: 50000 } })
      .expect(422);
  });

  it('el mismo atributo "km" SÍ se acepta para una alerta de categorySlug=coches (heredado de vehiculos)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Coches con km', categorySlug: 'coches', attributes: { km: 50000 } })
      .expect(201);
    expect(res.body.alert.categorySlug).toBe('coches');
  });

  it('sin categorySlug (alerta general), "km" se sigue aceptando (unión global, comportamiento sin cambios)', async () => {
    await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'General con km', attributes: { km: 50000 } })
      .expect(201);
  });

  it('PATCH que solo toca attributes valida contra la categoría YA guardada de la alerta', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Moviles para editar', categorySlug: 'moviles', attributes: { brand: 'Apple' } })
      .expect(201);
    const id = createRes.body.alert.id as string;

    // "km" no aplica a "moviles" (la categoría YA guardada, no tocada en este PATCH).
    await request(app.getHttpServer())
      .patch(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ attributes: { km: 50000 } })
      .expect(422);
  });

  it('radius (km) se persiste como radiusMeters', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Con geo', lat: 40.4168, lng: -3.7038, radius: 10 })
      .expect(201);

    const stored = await prisma.alert.findUniqueOrThrow({ where: { id: res.body.alert.id } });
    expect(stored.radiusMeters).toBe(10_000);
  });

  // ── listar ───────────────────────────────────────────────────────────────────

  it('GET /api/alerts → paginado, shape items/total/page/perPage/pages', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/alerts?page=1&perPage=20')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, perPage: 20 });
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('otro usuario no ve las alertas ajenas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/alerts')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  // ── editar / pausar ──────────────────────────────────────────────────────────

  it('PATCH /api/alerts/:id → edita name y criterios', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Antes de editar', maxPrice: 200 })
      .expect(201);
    const id = createRes.body.alert.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Después de editar', maxPrice: 600 })
      .expect(200);

    expect(patchRes.body.name).toBe('Después de editar');
    expect(Number(patchRes.body.maxPrice)).toBe(600);
  });

  it('PATCH /api/alerts/:id {active:false} → pausa sin borrar', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Para pausar' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ active: false })
      .expect(200);

    expect(patchRes.body.active).toBe(false);
    expect(patchRes.body.name).toBe('Para pausar');
  });

  // ── preview de coincidencias bajo demanda ────────────────────────────────────

  it('GET /api/alerts/:id/matches → devuelve las coincidencias actuales', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Para matches', categorySlug: 'moviles' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    const res = await request(app.getHttpServer())
      .get(`/api/alerts/${id}/matches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.hits.some((h: { id: string }) => h.id === matchingListingId)).toBe(true);
  });

  // ── borrar (idempotente) ─────────────────────────────────────────────────────

  it('DELETE /api/alerts/:id → 204, y una segunda vez también 204 (idempotente)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Para borrar' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    await request(app.getHttpServer())
      .delete(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
  });

  // ── aislamiento por usuario (IDOR) ───────────────────────────────────────────

  it('IDOR: otro usuario no puede editar una alerta ajena (404)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Ajena para IDOR edit' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    await request(app.getHttpServer())
      .patch(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Hackeada' })
      .expect(404);
  });

  it('IDOR: otro usuario no puede ver las coincidencias de una alerta ajena (404)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Ajena para IDOR matches' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    await request(app.getHttpServer())
      .get(`/api/alerts/${id}/matches`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('IDOR: otro usuario "borra" una alerta ajena → 204 pero no la borra realmente', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Ajena para IDOR delete' })
      .expect(201);
    const id = createRes.body.alert.id as string;

    // Scoped deleteMany matches 0 rows for someone else's alert — same
    // "no-op either way" idempotency as a real delete, but it must NOT
    // actually remove the owner's row.
    await request(app.getHttpServer())
      .delete(`/api/alerts/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(204);

    const stillExists = await prisma.alert.findUnique({ where: { id } });
    expect(stillExists).not.toBeNull();
  });
});
