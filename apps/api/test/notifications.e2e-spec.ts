import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let notifications: NotificationsService;
  let userToken: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    notifications = app.get(NotificationsService);

    const user = await prisma.user.create({
      data: {
        email: 'notif-user@example.com',
        name: 'Notif User',
        slug: 'notif-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;

    const other = await prisma.user.create({
      data: {
        email: 'notif-other@example.com',
        name: 'Notif Other',
        slug: 'notif-other',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    otherUserId = other.id;

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'notif-user@example.com', password: 'Test1234!' });
    userToken = loginRes.body.accessToken as string;

    const otherLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'notif-other@example.com', password: 'Test1234!' });
    otherToken = otherLoginRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── auth guard ──────────────────────────────────────────────────────────────

  it('GET /api/notifications sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });

  it('GET /api/notifications/unread-count sin auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/notifications/unread-count').expect(401);
  });

  it('POST /api/notifications/:id/read sin auth → 401', async () => {
    await request(app.getHttpServer()).post('/api/notifications/fake-id/read').expect(401);
  });

  // ── createNotification (B3's future entry point) + listado ──────────────────

  it('createNotification + GET /api/notifications → 200, la lista incluye el snapshot completo', async () => {
    await notifications.createNotification(userId, 'ALERT_MATCH', {
      alertId: 'alert-1',
      alertName: 'iPhone en Madrid',
      listingId: 'listing-1',
      listingSlug: 'iphone-de-prueba-abc123',
      listingTitle: 'iPhone de prueba',
    });

    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('ALERT_MATCH');
    expect(res.body.items[0].read).toBe(false);
    expect(res.body.items[0].data).toEqual({
      alertId: 'alert-1',
      alertName: 'iPhone en Madrid',
      listingId: 'listing-1',
      listingSlug: 'iphone-de-prueba-abc123',
      listingTitle: 'iPhone de prueba',
    });
  });

  it('GET /api/notifications → paginación (shape items/total/page/perPage/pages)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications?page=1&perPage=20')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, perPage: 20, total: 1, pages: 1 });
  });

  // ── unread-count ─────────────────────────────────────────────────────────────

  it('GET /api/notifications/unread-count → cuenta solo las no leídas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.count).toBe(1);
  });

  // ── aislamiento por usuario ──────────────────────────────────────────────────

  it('otro usuario no ve las notificaciones ajenas (lista vacía y contador 0)', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(listRes.body.total).toBe(0);

    const countRes = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(countRes.body.count).toBe(0);
  });

  // ── marcar leída ─────────────────────────────────────────────────────────────

  it('POST /api/notifications/:id/read → marca leída, baja el contador', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const id = listRes.body.items[0].id as string;

    await request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const countRes = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(countRes.body.count).toBe(0);

    const detailRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(detailRes.body.items[0].read).toBe(true);
    expect(detailRes.body.items[0].readAt).not.toBeNull();
  });

  it('POST /api/notifications/:id/read dos veces → 200 ambas (idempotente)', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const id = listRes.body.items[0].id as string;

    await request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('POST /api/notifications/:id/read con id de otro usuario → no marca nada (scoped por userId)', async () => {
    await notifications.createNotification(otherUserId, 'ALERT_MATCH', {
      alertId: 'alert-2',
      alertName: 'Bici en Barcelona',
      listingId: 'listing-2',
      listingSlug: 'bici-de-prueba-def456',
      listingTitle: 'Bici de prueba',
    });
    const otherListRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const otherNotificationId = otherListRes.body.items[0].id as string;

    // userToken (not the owner) tries to mark the other user's notification as read.
    await request(app.getHttpServer())
      .post(`/api/notifications/${otherNotificationId}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const stillUnread = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(stillUnread.body.count).toBe(1);
  });

  // ── read-all ─────────────────────────────────────────────────────────────────

  it('POST /api/notifications/read-all → marca todas las no leídas del usuario', async () => {
    await notifications.createNotification(userId, 'ALERT_MATCH', {
      alertId: 'alert-3',
      alertName: 'Coche en Valencia',
      listingId: 'listing-3',
      listingSlug: 'coche-de-prueba-ghi789',
      listingTitle: 'Coche de prueba',
    });
    await notifications.createNotification(userId, 'ALERT_MATCH', {
      alertId: 'alert-4',
      alertName: 'Piso en Sevilla',
      listingId: 'listing-4',
      listingSlug: 'piso-de-prueba-jkl012',
      listingTitle: 'Piso de prueba',
    });

    const beforeCount = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(beforeCount.body.count).toBe(2);

    await request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const afterCount = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(afterCount.body.count).toBe(0);

    // read-all must not touch the other user's still-unread notification.
    const otherCount = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(otherCount.body.count).toBe(1);
  });
});
