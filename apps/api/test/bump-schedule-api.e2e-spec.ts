/**
 * Bump automático, ráfaga 4 — la API de usuario (e2e).
 *
 * No hay lógica de negocio nueva aquí: son las reglas que las decisiones ya fijaron, puestas
 * donde el usuario las toca. Lo que se comprueba es que ninguna se puede saltar desde fuera
 * —el guard de propiedad, el tope de una por anuncio (D3), el interruptor (D7)— y que
 * reanudar sigue siendo un acto y no un efecto (D2).
 */

import { INestApplication } from '@nestjs/common';
import { BumpScheduleStatus, ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { BUMP_AUTO_ENABLED_SETTING } from 'src/modules/bump-schedule/bump-schedule.service';
import { MAX_SCHEDULES_SETTING } from 'src/modules/bump-schedule/bump-schedule-crud.service';

describe('Bump automático — API de usuario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let sellerToken: string;
  let otroToken: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;

    const hash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'bs-api@example.com', name: 'API Seller', slug: 'bs-api', passwordHash: hash, emailVerified: true },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: { email: 'bs-otro@example.com', name: 'Otro', slug: 'bs-otro', passwordHash: hash, emailVerified: true },
    });

    sellerToken = await login('bs-api@example.com');
    otroToken = await login('bs-otro@example.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return res.body.accessToken as string;
  }

  async function crearAnuncio(suffix: string, status: ListingStatus = ListingStatus.ACTIVE) {
    return prisma.listing.create({
      data: {
        title: `API bump ${suffix}`,
        slug: `bs-api-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para la API de bump automático',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true, slug: true },
    });
  }

  const post = (path: string, token: string, body?: object) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body ?? {});

  // ── Crear ──────────────────────────────────────────────────────────────────

  it('crea una programación y devuelve ya calculado el primer turno', async () => {
    const listing = await crearAnuncio('crear');

    const res = await post('/bump-schedules', sellerToken, {
      listingId: listing.id,
      intervalDays: 3,
      hourOfDay: 9,
    }).expect(201);

    expect(res.body).toMatchObject({ intervalDays: 3, hourOfDay: 9, status: 'ACTIVE' });
    // El primer turno lo calcula el BACKEND, con las mismas reglas de zona horaria que los
    // siguientes: la interfaz muestra, no deriva.
    expect(new Date(res.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('D3 — un anuncio no admite dos programaciones', async () => {
    const listing = await crearAnuncio('duplicada');
    const body = { listingId: listing.id, intervalDays: 2, hourOfDay: 8 };

    await post('/bump-schedules', sellerToken, body).expect(201);
    // 409 y no un error de base: el usuario no ha hecho nada raro, ya la tenía.
    await post('/bump-schedules', sellerToken, body).expect(409);
  });

  it('no se puede programar el anuncio de otro', async () => {
    const listing = await crearAnuncio('ajeno');

    await post('/bump-schedules', otroToken, {
      listingId: listing.id,
      intervalDays: 3,
      hourOfDay: 9,
    }).expect(403);
  });

  it('ni un anuncio que no está activo: no hay nada que subir', async () => {
    const listing = await crearAnuncio('vendido', ListingStatus.SOLD);

    await post('/bump-schedules', sellerToken, {
      listingId: listing.id,
      intervalDays: 3,
      hourOfDay: 9,
    }).expect(400);
  });

  it('valida la cadencia: ni 0 días ni una hora que no existe', async () => {
    const listing = await crearAnuncio('validacion');

    for (const body of [
      { listingId: listing.id, intervalDays: 0, hourOfDay: 9 },
      { listingId: listing.id, intervalDays: 31, hourOfDay: 9 },
      { listingId: listing.id, intervalDays: 3, hourOfDay: 24 },
      { listingId: listing.id, intervalDays: 3, hourOfDay: -1 },
    ]) {
      await post('/bump-schedules', sellerToken, body).expect(400);
    }
  });

  // ── El interruptor (D7) ────────────────────────────────────────────────────

  it('D7 — con la feature apagada no se puede crear, coherente con el cron', async () => {
    const listing = await crearAnuncio('flag');
    await prisma.setting.upsert({
      where: { key: BUMP_AUTO_ENABLED_SETTING },
      create: { key: BUMP_AUTO_ENABLED_SETTING, value: false },
      update: { value: false },
    });

    try {
      const res = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(400);
      // Si el interruptor no cortara también aquí, se podrían configurar programaciones que
      // el cron nunca ejecutaría — peor que no dejar configurarlas.
      expect(res.body.code).toBe('BUMP_AUTO_DISABLED');
    } finally {
      await prisma.setting.update({
        where: { key: BUMP_AUTO_ENABLED_SETTING },
        data: { value: true },
      });
    }
  });

  // ── Tope por usuario (D3) ──────────────────────────────────────────────────

  it('D3 — el tope de programaciones activas por usuario se respeta y es configurable', async () => {
    await prisma.setting.upsert({
      where: { key: MAX_SCHEDULES_SETTING },
      create: { key: MAX_SCHEDULES_SETTING, value: 1 },
      update: { value: 1 },
    });

    try {
      // Ya hay programaciones activas de las pruebas anteriores: con el tope a 1, cualquier
      // alta nueva sobra.
      const listing = await crearAnuncio('tope');
      const res = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(400);
      expect(res.body.message).toContain('límite');
    } finally {
      await prisma.setting.delete({ where: { key: MAX_SCHEDULES_SETTING } }).catch(() => undefined);
    }
  });

  // ── Pausar, reanudar, cancelar ─────────────────────────────────────────────

  describe('gestión de una programación', () => {
    it('pausar y reanudar: reanudar es un ACTO, y recalcula el próximo turno', async () => {
      const listing = await crearAnuncio('pausa');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(201);
      const id = creada.body.id;

      const pausada = await post(`/bump-schedules/${id}/pausar`, sellerToken).expect(201);
      expect(pausada.body.status).toBe(BumpScheduleStatus.PAUSED_BY_USER);

      const reanudada = await post(`/bump-schedules/${id}/reanudar`, sellerToken).expect(201);
      expect(reanudada.body.status).toBe(BumpScheduleStatus.ACTIVE);
      // Desde AHORA: si estuvo pausada un mes, reanudar no debe disparar un bump inmediato
      // por un turno que venció hace semanas.
      expect(new Date(reanudada.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('una pausada por falta de saldo se reanuda igual: la decisión es del usuario', async () => {
      const listing = await crearAnuncio('sin-saldo-reanuda');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(201);

      // Como si el scheduler la hubiera parado por un 402.
      await prisma.bumpSchedule.update({
        where: { id: creada.body.id },
        data: { status: BumpScheduleStatus.PAUSED_NO_FUNDS },
      });

      const res = await post(`/bump-schedules/${creada.body.id}/reanudar`, sellerToken).expect(201);
      expect(res.body.status).toBe(BumpScheduleStatus.ACTIVE);
    });

    it('pero no si el anuncio dejó de estar activo: se quedaría pausándose sola otra vez', async () => {
      const listing = await crearAnuncio('reanuda-inactivo');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(201);

      await prisma.$transaction([
        prisma.bumpSchedule.update({
          where: { id: creada.body.id },
          data: { status: BumpScheduleStatus.PAUSED_LISTING_INACTIVE },
        }),
        prisma.listing.update({ where: { id: listing.id }, data: { status: ListingStatus.SOLD } }),
      ]);

      await post(`/bump-schedules/${creada.body.id}/reanudar`, sellerToken).expect(400);
    });

    it('editar la cadencia recalcula el próximo turno', async () => {
      const listing = await crearAnuncio('editar');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 7,
        hourOfDay: 9,
      }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/bump-schedules/${creada.body.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ intervalDays: 2, hourOfDay: 20 })
        .expect(200);

      expect(res.body).toMatchObject({ intervalDays: 2, hourOfDay: 20 });
      // Esperar al turno viejo sería aplicar una cadencia que ya no existe.
      expect(new Date(res.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('cancelar la borra, y sus turnos con ella', async () => {
      const listing = await crearAnuncio('cancelar');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(201);
      await prisma.bumpRun.create({
        data: { scheduleId: creada.body.id, slot: new Date(), outcome: 'APPLIED', cost: 5 },
      });

      await request(app.getHttpServer())
        .delete(`/api/bump-schedules/${creada.body.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(204);

      expect(await prisma.bumpSchedule.findUnique({ where: { id: creada.body.id } })).toBeNull();
      expect(await prisma.bumpRun.count({ where: { scheduleId: creada.body.id } })).toBe(0);
    });

    it('nada de esto lo puede hacer otro usuario', async () => {
      const listing = await crearAnuncio('ajeno-gestion');
      const creada = await post('/bump-schedules', sellerToken, {
        listingId: listing.id,
        intervalDays: 3,
        hourOfDay: 9,
      }).expect(201);
      const id = creada.body.id;

      await post(`/bump-schedules/${id}/pausar`, otroToken).expect(403);
      await post(`/bump-schedules/${id}/reanudar`, otroToken).expect(403);
      await request(app.getHttpServer())
        .delete(`/api/bump-schedules/${id}`)
        .set('Authorization', `Bearer ${otroToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/bump-schedules/${id}/turnos`)
        .set('Authorization', `Bearer ${otroToken}`)
        .expect(403);
    });
  });

  // ── Lectura ────────────────────────────────────────────────────────────────

  it('lista solo las propias, con el anuncio al que pertenecen', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bump-schedules')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(item.listing).toMatchObject({ title: expect.any(String), slug: expect.any(String) });
    }

    const ajena = await request(app.getHttpServer())
      .get('/api/bump-schedules')
      .set('Authorization', `Bearer ${otroToken}`)
      .expect(200);
    expect(ajena.body.items).toHaveLength(0);
  });

  it('el historial incluye los turnos que NO cobraron: los huecos también se explican', async () => {
    const listing = await crearAnuncio('historial');
    const creada = await post('/bump-schedules', sellerToken, {
      listingId: listing.id,
      intervalDays: 3,
      hourOfDay: 9,
    }).expect(201);

    await prisma.bumpRun.createMany({
      data: [
        { scheduleId: creada.body.id, slot: new Date('2026-03-01T08:00:00Z'), outcome: 'APPLIED', paidWith: 'CREDITS', cost: 5 },
        { scheduleId: creada.body.id, slot: new Date('2026-03-04T08:00:00Z'), outcome: 'SKIPPED_COOLDOWN' },
      ],
    });

    const res = await request(app.getHttpServer())
      .get(`/api/bump-schedules/${creada.body.id}/turnos`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.total).toBe(2);
    // Un historial que solo enseñara los cobros no explicaría por qué hay días sin subida.
    expect(res.body.items.map((r: { outcome: string }) => r.outcome)).toEqual(
      expect.arrayContaining(['APPLIED', 'SKIPPED_COOLDOWN']),
    );
  });

  // ── La tarjeta ─────────────────────────────────────────────────────────────

  it('la programación viaja en el payload de PROPIETARIO, no en el público', async () => {
    const listing = await crearAnuncio('payload');
    await post('/bump-schedules', sellerToken, {
      listingId: listing.id,
      intervalDays: 5,
      hourOfDay: 10,
    }).expect(201);

    const mias = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const card = mias.body.items.find((i: { id: string }) => i.id === listing.id);
    expect(card.bumpSchedule).toMatchObject({ status: 'ACTIVE', intervalDays: 5, hourOfDay: 10 });

    // La ficha es pública: que un vendedor programe bumps es asunto suyo.
    const ficha = await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
    expect(ficha.body.bumpSchedule).toBeUndefined();
  });

  it('un anuncio sin programación la trae a null, no ausente', async () => {
    const listing = await crearAnuncio('sin-programacion');

    const mias = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const card = mias.body.items.find((i: { id: string }) => i.id === listing.id);
    expect(card.bumpSchedule).toBeNull();
  });
});
