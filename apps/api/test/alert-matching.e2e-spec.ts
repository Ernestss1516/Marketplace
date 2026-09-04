import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';
import { pollUntil } from './helpers/poll';
import { conColaPausada, getExistingJobs } from './helpers/queue';
import { AlertMatchingService } from '../src/modules/alerts/alert-matching.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { QUEUE_ALERT_MATCHING, QUEUE_NOTIFICATIONS } from '../src/infra/queue/queue.constants';

const MADRID = { latitude: 40.4168, longitude: -3.7038, city: 'Madrid', province: 'Madrid' };
const BARCELONA = { lat: 41.3874, lng: 2.1686 };

describe('Alert matching (e2e) — B3', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let matching: AlertMatchingService;
  let notifications: NotificationsService;
  let notificationQueue: Queue;
  let matchingQueue: Queue;
  let categoryId: string;
  let sellerToken: string;

  /**
   * EL FIXTURE QUE CONDUCE EL MATCHING A MANO, CON EL WORKER PARADO.
   *
   * ── La carrera que cierra, medida ──────────────────────────────────────────
   *
   * Cinco tramos de esta suite montan su escenario igual: publican, esperan al
   * índice y llaman a `matching.matchListing()` a mano para que sus aserciones no
   * dependan de tiempos. Pero `publish()` YA dispara ese mismo trabajo por su
   * cuenta —`IndexingProcessor` encola `alert-matching` en cuanto el documento es
   * consultable—, así que `matchListing` se ejecutaba DOS VECES a la vez: una en
   * el worker y otra en el test.
   *
   * Y las dos pasadas no son intercambiables, porque la deduplicación vive en el
   * `alertMatch.create`: quien pierde la carrera recibe un P2002 y hace `continue`,
   * SALTÁNDOSE la creación del aviso (alert-matching.service.ts). O sea que si el
   * worker ganaba el `create` y todavía estaba escribiendo el aviso, la pasada del
   * test no escribía ninguno y el test leía cero. Es exactamente el rojo del CI
   * (33792790284, intento 1): `expect(match).toBeDefined() → undefined`, con los
   * cuatro casos de `hasMatch` de al lado en verde.
   *
   * Reproducido de forma determinista alargando `createNotification` a 2 s: el caso
   * cae siempre. Con la cola parada, verde con ese mismo ensanchado.
   *
   * ── Por qué PAUSAR y no ESPERAR ────────────────────────────────────────────
   *
   * Un `pollUntil` al aviso también quitaría el rojo, y es lo que se hizo en su día
   * en el bloque de deduplicación (líneas ~271) cuando esto mordió por primera vez.
   * Pero deja viva la concurrencia: las aserciones de AUSENCIA («esta alerta NO
   * matchea») siguen midiendo un escenario a medio hacer. Con la cola parada, la
   * pasada del test es la ÚNICA, y las cinco aserciones —presencia, ausencia y
   * aviso— dicen lo que parece que dicen.
   *
   * Mismo molde que `rf7`/`h8` (ver `helpers/queue.ts`): la pausa por TRAMO, con
   * `finally`, nunca de suite — los bloques de `renew()`, moderación y flujo
   * completo ejercitan la tubería A PROPÓSITO y siguen con sus esperas.
   */
  async function publicarYEmparejarSinWorker(listingId: string): Promise<void> {
    await conColaPausada(matchingQueue, async () => {
      await publish(listingId);
      await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, listingId);

      // Se espera a VER el trabajo en la cola parada antes de seguir. No es
      // decoración: `waitForIndex` mira Meilisearch, y el `IndexingProcessor`
      // encola `alert-matching` DESPUÉS de que el documento sea consultable, así
      // que el test puede llegar aquí antes que el encolado. Además afirma, de
      // paso, que la tubería real sigue encolándolo.
      await pollUntil(
        async () =>
          (await getExistingJobs(matchingQueue, ['waiting', 'delayed'])).some(
            (j) => (j.data as { listingId?: string })?.listingId === listingId,
          ),
        15_000,
      );

      await matching.matchListing(listingId);

      // Y se DESCARTA. Lo encolado es ya un duplicado exacto de lo que el test
      // acaba de ejecutar (todo P2002), y dejarlo suelto para que se procese al
      // soltar la pausa lo pondría a correr sobre un escenario que para entonces
      // ya es otro — sembrando la siguiente carrera en vez de cerrar ésta.
      await matchingQueue.drain();
    });
  }

  async function createUser(email: string, slug: string, role: 'USER' | 'ADMIN' = 'USER') {
    const user = await prisma.user.create({
      data: {
        email,
        name: slug,
        slug,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role,
      },
    });
    // ADMIN solo puede entrar por /auth/admin-login — /auth/login lo rechaza
    // (ver AuthService.login/adminLogin).
    const login = await request(app.getHttpServer())
      .post(role === 'ADMIN' ? '/api/auth/admin-login' : '/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return { id: user.id, token: login.body.accessToken as string };
  }

  async function createListing(overrides: Record<string, unknown> = {}, token = sellerToken) {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Anuncio de prueba matching',
        description: 'Descripción de prueba para el matching de alertas',
        price: 300,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: MADRID.city,
        province: MADRID.province,
        latitude: MADRID.latitude,
        longitude: MADRID.longitude,
        attributes: {},
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  async function publish(listingId: string, token = sellerToken) {
    await request(app.getHttpServer())
      .post(`/api/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  async function createAlert(token: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/api/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body.alert.id as string;
  }

  async function hasMatch(alertId: string, listingId: string): Promise<boolean> {
    const row = await prisma.alertMatch.findUnique({
      where: { alertId_listingId: { alertId, listingId } },
    });
    return row !== null;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    await cleanDb(prisma);
    await resetMeili(meili);

    matching = app.get(AlertMatchingService);
    notifications = app.get(NotificationsService);
    notificationQueue = app.get<Queue>(getQueueToken(QUEUE_NOTIFICATIONS));
    matchingQueue = app.get<Queue>(getQueueToken(QUEUE_ALERT_MATCHING));

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const seller = await createUser('am-seller@example.com', 'am-seller');
    sellerToken = seller.token;
  });

  afterAll(async () => {
    await prisma.setting.update({ where: { key: 'badWordList' }, data: { value: [] } });
    await app.close();
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fase 1 — candidatas SQL: categoría, tipo, rango de precio
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Fase 1 — pre-filtrado SQL', () => {
    let buyer: { id: string; token: string };
    let alertNoCategory: string;
    let alertMoviles: string;
    let alertCoches: string;
    let alertPriceTooLow: string;
    let listingId: string;

    beforeAll(async () => {
      buyer = await createUser('am-buyer-fase1@example.com', 'am-buyer-fase1');
      alertNoCategory = await createAlert(buyer.token, { name: 'Sin categoría' });
      alertMoviles = await createAlert(buyer.token, { name: 'Móviles', categorySlug: 'moviles' });
      alertCoches = await createAlert(buyer.token, { name: 'Coches', categorySlug: 'coches' });
      alertPriceTooLow = await createAlert(buyer.token, { name: 'Precio bajo', maxPrice: 50 });

      listingId = await createListing({ title: 'iPhone Fase 1' });
      await publicarYEmparejarSinWorker(listingId);
    });

    it('alerta sin categoría (null) matchea cualquier anuncio activo', async () => {
      expect(await hasMatch(alertNoCategory, listingId)).toBe(true);
    });

    it('alerta con categoría coincidente matchea', async () => {
      expect(await hasMatch(alertMoviles, listingId)).toBe(true);
    });

    it('alerta con categoría distinta NO matchea', async () => {
      expect(await hasMatch(alertCoches, listingId)).toBe(false);
    });

    it('precio del anuncio fuera del rango de la alerta NO matchea', async () => {
      expect(await hasMatch(alertPriceTooLow, listingId)).toBe(false);
    });

    it('cada match confirmado crea una Notification ALERT_MATCH con snapshot completo', async () => {
      const list = await notifications.findByUser(buyer.id, 1, 20);
      const match = list.items.find(
        (n) => (n.data as { alertId: string }).alertId === alertMoviles,
      );
      expect(match).toBeDefined();
      expect(match!.type).toBe('ALERT_MATCH');
      const data = match!.data as Record<string, unknown>;
      expect(data.listingId).toBe(listingId);
      expect(data.alertName).toBe('Móviles');
      expect(typeof data.listingSlug).toBe('string');
      expect(typeof data.listingTitle).toBe('string');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fase 2 — confirmación real con Meili: atributos y geo (fuera del SQL)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Fase 2 — confirmación Meili (atributos/geo)', () => {
    let buyer: { id: string; token: string };
    let alertAttrMismatch: string;
    let alertAttrMatch: string;
    let alertGeoFar: string;
    let alertGeoNear: string;
    let listingId: string;

    beforeAll(async () => {
      buyer = await createUser('am-buyer-fase2@example.com', 'am-buyer-fase2');
      alertAttrMismatch = await createAlert(buyer.token, {
        name: 'Brand Samsung',
        categorySlug: 'moviles',
        attributes: { brand: 'Samsung' },
      });
      alertAttrMatch = await createAlert(buyer.token, {
        name: 'Brand Apple',
        categorySlug: 'moviles',
        attributes: { brand: 'Apple' },
      });
      alertGeoFar = await createAlert(buyer.token, {
        name: 'Geo lejos',
        lat: BARCELONA.lat,
        lng: BARCELONA.lng,
        radius: 5,
      });
      alertGeoNear = await createAlert(buyer.token, {
        name: 'Geo cerca',
        lat: MADRID.latitude,
        lng: MADRID.longitude,
        radius: 50,
      });

      listingId = await createListing({
        title: 'iPhone Fase 2',
        attributes: { brand: 'Apple', ram: 8 },
      });
      await publicarYEmparejarSinWorker(listingId);
    });

    it('candidata de Fase 1 cuyo atributo NO coincide se descarta por Meili (sin notificar)', async () => {
      expect(await hasMatch(alertAttrMismatch, listingId)).toBe(false);
    });

    it('candidata cuyo atributo SÍ coincide se confirma y notifica', async () => {
      expect(await hasMatch(alertAttrMatch, listingId)).toBe(true);
    });

    it('alerta geo cuyo radio NO cubre la ubicación del anuncio NO matchea', async () => {
      expect(await hasMatch(alertGeoFar, listingId)).toBe(false);
    });

    it('alerta geo cuyo radio SÍ cubre la ubicación del anuncio matchea', async () => {
      expect(await hasMatch(alertGeoNear, listingId)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Deduplicación — mismo (alerta, anuncio) no se re-notifica
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Deduplicación', () => {
    let buyer: { id: string; token: string };
    let alertId: string;
    let listingId: string;

    beforeAll(async () => {
      buyer = await createUser('am-buyer-dedup@example.com', 'am-buyer-dedup');
      alertId = await createAlert(buyer.token, { name: 'Dedup', categorySlug: 'moviles' });

      listingId = await createListing({ title: 'iPhone Dedup' });
      await publicarYEmparejarSinWorker(listingId);
    });

    it('primera pasada notifica', async () => {
      expect(await hasMatch(alertId, listingId)).toBe(true);
    });

    it('reintentar matchListing() para el mismo anuncio no duplica el match ni la notificación', async () => {
      // Se espera al ESTADO DEFINITIVO de la primera pasada antes de medir.
      //
      // Sin esto, `beforeNotifs` podía leerse mientras el aviso de la pasada del
      // `beforeAll` seguía en vuelo: salía 0, llegaba entre las dos lecturas, y
      // el test fallaba con un «esperaba 0, recibí 1» que no tiene nada que ver
      // con la deduplicación que prueba. Ocurrió una vez en la batería completa y
      // no se reprodujo al correr la suite sola — el síntoma clásico de medir una
      // presencia en vez de un estado (ver `helpers/async-state.ts`).
      await pollUntil(
        async () =>
          (await notifications.findByUser(buyer.id, 1, 50)).items.some(
            (n) => (n.data as { alertId: string }).alertId === alertId,
          ),
        15_000,
      );

      const beforeMatches = await prisma.alertMatch.count({ where: { alertId, listingId } });
      const beforeNotifs = (await notifications.findByUser(buyer.id, 1, 50)).items.filter(
        (n) => (n.data as { alertId: string }).alertId === alertId,
      ).length;

      // Simulates a BullMQ retry re-running the same job.
      await matching.matchListing(listingId);
      await matching.matchListing(listingId);

      const afterMatches = await prisma.alertMatch.count({ where: { alertId, listingId } });
      const afterNotifs = (await notifications.findByUser(buyer.id, 1, 50)).items.filter(
        (n) => (n.data as { alertId: string }).alertId === alertId,
      ).length;

      expect(afterMatches).toBe(beforeMatches);
      expect(afterNotifs).toBe(beforeNotifs);
      expect(afterMatches).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // renew() dispara matching (con dedup); reserve/closeDeal NO disparan
  // ═══════════════════════════════════════════════════════════════════════════
  describe('renew() vs reserve()/closeDeal()', () => {
    let alertOld: { id: string; token: string };
    let alertNew: { id: string; token: string };
    let alertOldId: string;
    let alertNewId: string;
    let listingId: string;

    beforeAll(async () => {
      alertOld = await createUser('am-buyer-renew-old@example.com', 'am-buyer-renew-old');
      alertOldId = await createAlert(alertOld.token, { name: 'Antes de publicar', categorySlug: 'moviles' });

      listingId = await createListing({ title: 'iPhone Renew' });
      // Drenar aquí no es cosmético: la alerta `alertNew` se crea DOS LÍNEAS más
      // abajo y este bloque afirma que todavía no tiene match. Un trabajo de la
      // publicación que siguiera pendiente podría procesarse justo después de
      // crearla y emparejarla — un rojo por la ausencia que se acaba de afirmar.
      await publicarYEmparejarSinWorker(listingId);
      expect(await hasMatch(alertOldId, listingId)).toBe(true);

      // Alert created AFTER the original publish — must NOT have a match yet.
      alertNew = await createUser('am-buyer-renew-new@example.com', 'am-buyer-renew-new');
      alertNewId = await createAlert(alertNew.token, { name: 'Después de publicar', categorySlug: 'moviles' });
      expect(await hasMatch(alertNewId, listingId)).toBe(false);

      // Simulate expiry, then renew via the real HTTP endpoint — exercises the
      // full async chain (index job → chained match-alerts job), not a direct call.
      await prisma.listing.update({ where: { id: listingId }, data: { status: 'EXPIRED' } });
      await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/renew`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      await pollUntil(() => hasMatch(alertNewId, listingId), 15_000);
    });

    it('renew() notifica a la alerta creada después de la publicación original', async () => {
      expect(await hasMatch(alertNewId, listingId)).toBe(true);
    });

    it('renew() NO re-notifica a la alerta ya notificada en la publicación original', async () => {
      const count = await prisma.alertMatch.count({ where: { alertId: alertOldId, listingId } });
      expect(count).toBe(1);
    });

    it('reserve() y closeDeal() NO disparan matching (ninguna alerta nueva se notifica)', async () => {
      const listing2Id = await createListing({ title: 'iPhone Reserve Sold' });
      // Misma razón que en el bloque de arriba: `lateAlert` nace después y este
      // caso afirma que NADA la empareja. El fixture deja la ronda de la
      // publicación cerrada y sin trabajo suelto que pueda hacerlo por detrás.
      await publicarYEmparejarSinWorker(listing2Id);

      const lateAlert = await createUser('am-buyer-reserve@example.com', 'am-buyer-reserve');
      const lateAlertId = await createAlert(lateAlert.token, { name: 'Tarde', categorySlug: 'moviles' });

      await request(app.getHttpServer())
        .post(`/api/listings/${listing2Id}/reserve`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/listings/${listing2Id}/deals`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({})
        .expect(201);

      // No 'match-alerts' job is ever enqueued for reserve/deals (triggerAlertMatch
      // stays false) — wait past normal processing time, then assert absence.
      await new Promise((r) => setTimeout(r, 2_000));
      expect(await hasMatch(lateAlertId, listing2Id)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Moderación: PENDING_REVIEW no dispara; approve sí
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Moderación', () => {
    let moderator: { id: string; token: string };
    let buyer: { id: string; token: string };
    let alertId: string;
    let listingId: string;

    beforeAll(async () => {
      await prisma.setting.update({
        where: { key: 'badWordList' },
        data: { value: ['prohibido'] },
      });

      moderator = await createUser('am-moderator@example.com', 'am-moderator', 'ADMIN');
      buyer = await createUser('am-buyer-moderation@example.com', 'am-buyer-moderation');
      alertId = await createAlert(buyer.token, { name: 'Moderación', categorySlug: 'moviles' });

      listingId = await createListing({ title: 'Anuncio prohibido de prueba' });
      const publishRes = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/publish`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(publishRes.body.status).toBe('PENDING_REVIEW');
    });

    it('PENDING_REVIEW no dispara matching', async () => {
      // No indexing job was even enqueued for a non-ACTIVE listing, so there is
      // nothing to poll for — a short grace wait is enough to prove absence.
      await new Promise((r) => setTimeout(r, 1_000));
      expect(await hasMatch(alertId, listingId)).toBe(false);
    });

    it('approveListing() dispara matching tras la aprobación', async () => {
      await request(app.getHttpServer())
        .post(`/api/moderation/listings/${listingId}/approve`)
        .set('Authorization', `Bearer ${moderator.token}`)
        .expect(200);

      await pollUntil(() => hasMatch(alertId, listingId), 15_000);
      expect(await hasMatch(alertId, listingId)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E2E completo de la feature: crear alerta → publicar → notificación in-app + email
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Feature completa: crear alerta → publicar → notificación', () => {
    it('el flujo real end-to-end entrega notificación in-app y encola el email, sin carrera', async () => {
      // Dedicated seller — the shared `sellerToken` already has several ACTIVE
      // listings from earlier describe blocks and would hit the free-plan limit.
      const fullFlowSeller = await createUser('am-seller-fullflow@example.com', 'am-seller-fullflow');
      const buyer = await createUser('am-buyer-fullflow@example.com', 'am-buyer-fullflow');
      const alertId = await createAlert(buyer.token, {
        name: 'Flujo completo',
        categorySlug: 'moviles',
        maxPrice: 1000,
      });

      // Se REGISTRAN los encolados en vez de mirar la cola después. La cola tiene
      // `removeOnComplete: true` y el NotificationProcessor está vivo en los tests,
      // así que el job `send-alert-email` se procesa y SE BORRA: mirar la cola a
      // posteriori es una ventana de dos lados —demasiado pronto (aún no encolado)
      // o demasiado tarde (ya consumido y eliminado)— y ninguna espera arregla el
      // segundo lado. Capturar en el momento del `add` no tiene ventana.
      // OJO con QUÉ instancia se espía: cada módulo que llama a
      // `BullModule.registerQueue()` recibe su PROPIA instancia de Queue (la deuda
      // del "retry fantasma", ver queue-retry.e2e-spec.ts). `app.get(getQueueToken
      // (QUEUE_NOTIFICATIONS))` NO es la que usa AlertMatchingService para encolar
      // — comprobado: espiar esa no registraba ni un `add`. Hay que espiar el campo
      // inyectado en el servicio, que es el productor real.
      const matchingSvc = app.get(AlertMatchingService);
      const colaDelProductor = (matchingSvc as unknown as { notificationQueue: Queue })
        .notificationQueue;

      const encolados: Array<{ name: string; data: Record<string, unknown> }> = [];
      const addReal = colaDelProductor.add.bind(colaDelProductor);
      const addSpy = jest
        .spyOn(colaDelProductor, 'add')
        .mockImplementation((name: string, data: Record<string, unknown>, opts?: unknown) => {
          encolados.push({ name, data });
          return (addReal as (...a: unknown[]) => Promise<unknown>)(name, data, opts) as never;
        });

      try {
        const listingId = await createListing({ title: 'iPhone Flujo Completo' }, fullFlowSeller.token);
        await publish(listingId, fullFlowSeller.token); // real HTTP flow — index job chains match-alerts itself

        await pollUntil(() => hasMatch(alertId, listingId), 15_000);

        const list = await request(app.getHttpServer())
          .get('/api/notifications')
          .set('Authorization', `Bearer ${buyer.token}`)
          .expect(200);
        const match = list.body.items.find(
          (n: { data: { alertId: string } }) => n.data.alertId === alertId,
        );
        expect(match).toBeDefined();
        expect(match.type).toBe('ALERT_MATCH');

        const unread = await request(app.getHttpServer())
          .get('/api/notifications/unread-count')
          .set('Authorization', `Bearer ${buyer.token}`)
          .expect(200);
        expect(unread.body.count).toBeGreaterThanOrEqual(1);

        // The email job was enqueued for this alert (in-app and email are
        // independent dispatches from the same match).
        //
        // Se ESPERA al estado definitivo en vez de muestrear un instante: el
        // `alertMatch.create` (alert-matching.service.ts:74) ocurre ANTES del
        // `notificationQueue.add` (:90), así que `hasMatch` puede ser cierto y el
        // email todavía no estar encolado. Esa era la carrera que dejaba
        // `emailJob` en `undefined`.
        await pollUntil(
          async () =>
            encolados.some(
              (j) => j.name === 'send-alert-email' && j.data.alertName === 'Flujo completo',
            ),
          15_000,
        );

        const emailJob = encolados.find(
          (j) => j.name === 'send-alert-email' && j.data.alertName === 'Flujo completo',
        );
        expect(emailJob).toBeDefined();
      } finally {
        addSpy.mockRestore();
      }
    });

    it('QUEUE_NOTIFICATIONS tiene retry configurado (attempts:3 + backoff)', () => {
      expect(notificationQueue.opts.defaultJobOptions?.attempts).toBe(3);
      expect(notificationQueue.opts.defaultJobOptions?.backoff).toMatchObject({
        type: 'exponential',
        delay: 2_000,
      });
    });

    it('QUEUE_ALERT_MATCHING también tiene retry configurado', () => {
      const matchingQueue = app.get<Queue>(getQueueToken(QUEUE_ALERT_MATCHING));
      expect(matchingQueue.opts.defaultJobOptions?.attempts).toBe(3);
    });
  });
});
