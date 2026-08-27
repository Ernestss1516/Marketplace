import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ListingPauseOrigin, ListingStatus, Prisma, PrismaClient, UserStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ESTADOS_EN_VUELO, getExistingJobs } from './helpers/queue';
import { QUEUE_BILLING } from 'src/infra/queue/queue.constants';
import { BILLING_JOB } from 'src/modules/billing/billing.types';
import { BillingService } from 'src/modules/billing/billing.service';
import { FREE_ACTIVE_LIMIT_SETTING } from 'src/modules/listing-gate/listing-limits';

/**
 * BORRADO DE CUENTAS — C2: ARCHIVAR Y DESARCHIVAR.
 *
 * Barreras (diseño §8.1 C2):
 *   1. Archivar → no entra; sus anuncios PAUSED, fuera del índice, sin cuota.
 *   2. Desarchivar restaura EL ESTADO PREVIO — un baneado archivado vuelve a
 *      BANNED, no a ACTIVE. **Es LA barrera del cuerpo** (§1.1).
 *   3. Los anuncios vuelven RESPETANDO EL CUPO; lo que no cabe se queda PAUSED.
 *   4. La suscripción se cancela (no se le sigue cobrando a quien se fue).
 *   5. Las dos entradas: el usuario la suya, el staff la de otro.
 */
describe('Borrado de cuentas C2 — archivar y desarchivar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let billingQueue: Queue;
  let categoryId: string;
  let hash: string;

  const PASSWORD = 'Test1234!';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    billingQueue = app.get<Queue>(getQueueToken(QUEUE_BILLING));
    hash = await bcrypt.hash(PASSWORD, 4);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  let n = 0;
  async function crearUsuario(marca: string, status: UserStatus = 'ACTIVE') {
    n += 1;
    return prisma.user.create({
      data: {
        email: `c2-${marca}-${n}@example.com`,
        name: `C2 ${marca}`,
        slug: `c2-${marca}-${n}`,
        passwordHash: hash,
        emailVerified: true,
        status,
      },
    });
  }

  async function crearAnuncio(sellerId: string, status: ListingStatus, marca: string) {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `C2 ${marca}`,
        slug: `c2-anuncio-${marca}-${n}`,
        description: 'descripción de prueba con longitud suficiente',
        price: new Prisma.Decimal('30.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  async function tokenDe(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  /** Un moderador para las entradas de staff. */
  async function crearModerador() {
    n += 1;
    const email = `c2-mod-${n}@example.com`;
    await prisma.user.create({
      data: {
        email,
        name: 'C2 Moderador',
        slug: `c2-mod-${n}`,
        passwordHash: hash,
        emailVerified: true,
        role: 'MODERATOR',
      },
    });
    return tokenDe(email);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 5 — las dos entradas
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 5 — dos entradas, un solo efecto', () => {
    it('EL USUARIO archiva la suya: SELF_REQUEST y archivedById null', async () => {
      const user = await crearUsuario('auto');
      const token = await tokenDe(user.email);

      await request(app.getHttpServer())
        .post('/api/users/me/archive')
        .set('Authorization', `Bearer ${token}`)
        .send({ note: 'Ya no lo uso' })
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ARCHIVED);
      expect(tras.archiveReason).toBe('SELF_REQUEST');
      // `null` = lo hizo él mismo. Es lo que distingue esta entrada de la otra.
      expect(tras.archivedById).toBeNull();
      expect(tras.archiveNote).toBe('Ya no lo uso');
      expect(tras.archivedAt).not.toBeNull();
      expect(tras.statusBeforeArchive).toBe(UserStatus.ACTIVE);
    });

    it('EL STAFF archiva la de otro: STAFF_ACTION y archivedById del moderador', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('por-staff');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({ note: 'Cuenta duplicada' })
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ARCHIVED);
      expect(tras.archiveReason).toBe('STAFF_ACTION');
      expect(tras.archivedById).not.toBeNull();
    });

    it('archivar es MODERATOR+: un usuario normal no puede archivar a otro', async () => {
      const user = await crearUsuario('sin-permiso');
      const victima = await crearUsuario('victima');
      const token = await tokenDe(user.email);

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${victima.id}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 1 — archivar cierra la puerta y saca del escaparate
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 1 — archivar: no entra, y sus anuncios se pausan', () => {
    it('tras archivar no puede entrar (403) y el token viejo tampoco vale', async () => {
      const user = await crearUsuario('sin-entrada');
      const token = await tokenDe(user.email);

      await request(app.getHttpServer())
        .post('/api/users/me/archive')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);

      // El token de antes: muerto por `tokenVersion`, sin depender del gate.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      // Y volver a entrar tampoco: el gate de C1 lo rechaza.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(403);
    });

    it('los ACTIVE y RESERVED pasan a PAUSED con la marca; DRAFT y PENDING_REVIEW no se tocan', async () => {
      const user = await crearUsuario('anuncios');
      const activo = await crearAnuncio(user.id, 'ACTIVE', 'activo');
      const reservado = await crearAnuncio(user.id, 'RESERVED', 'reservado');
      const borrador = await crearAnuncio(user.id, 'DRAFT', 'borrador');
      const enRevision = await crearAnuncio(user.id, 'PENDING_REVIEW', 'revision');
      const vendido = await crearAnuncio(user.id, 'SOLD', 'vendido');

      const token = await tokenDe(user.email);
      await request(app.getHttpServer())
        .post('/api/users/me/archive')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);

      const leer = async (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });

      // Lo que SE VE, pausado y marcado.
      for (const l of [activo, reservado]) {
        const tras = await leer(l.id);
        expect(tras.status).toBe(ListingStatus.PAUSED);
        // RESIDUO BANNED — la marca dejó de ser un booleano: ahora dice QUIÉN pausó.
        // `ARCHIVE` es lo que `unarchive` busca; `BAN` es lo que no debe tocar.
        expect(tras.pausedByAccountReason).toBe(ListingPauseOrigin.ARCHIVE);
      }

      // Lo que NO se ve, intacto — aquí se disuelve D-13: no hace falta llevar un
      // DRAFT a ARCHIVED (que sería ilegal) porque no hay nada que ocultar.
      expect((await leer(borrador.id)).status).toBe(ListingStatus.DRAFT);
      expect((await leer(enRevision.id)).status).toBe(ListingStatus.PENDING_REVIEW);
      expect((await leer(vendido.id)).status).toBe(ListingStatus.SOLD);
      for (const l of [borrador, enRevision, vendido]) {
        expect((await leer(l.id)).pausedByAccountReason).toBeNull();
      }
    });

    it('un anuncio pausado por el archivado NO cuenta para la cuota de activos', async () => {
      const user = await crearUsuario('cuota-libre');
      await crearAnuncio(user.id, 'ACTIVE', 'ocupa');

      const token = await tokenDe(user.email);
      await request(app.getHttpServer())
        .post('/api/users/me/archive')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);

      // La cuota cuenta `status: ACTIVE`; pausado no lo está. Se comprueba sobre
      // la base porque es lo que la regla mira.
      const activos = await prisma.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE },
      });
      expect(activos).toBe(0);
    });

    it('archivar deja constancia en AuditLog, con quién y cuántos anuncios se pausaron', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('auditado');
      await crearAnuncio(user.id, 'ACTIVE', 'auditado');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'USER_ARCHIVE', resourceType: 'User', resourceId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log?.before).toMatchObject({ status: 'ACTIVE' });
      expect(log?.after).toMatchObject({
        status: 'ARCHIVED',
        archiveReason: 'STAFF_ACTION',
        autoArchivado: false,
        anunciosPausados: 1,
      });
    });

    it('invalida los tokens de verificación y de reseteo pendientes', async () => {
      const user = await crearUsuario('con-tokens');
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: `c2-reset-${user.id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const token = await tokenDe(user.email);
      await request(app.getHttpServer())
        .post('/api/users/me/archive')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);

      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 2 — LA barrera: desarchivar NO lava el ban
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 2 — desarchivar restaura EL ESTADO PREVIO', () => {
    /**
     * LA BARRERA DEL CUERPO ENTERO. Si `unarchive` devolviera a `ACTIVE` por
     * defecto, archivar a un baneado sería la forma de levantarle el ban — y la
     * podría ejecutar un MODERATOR, que no tiene permiso para desbanear.
     */
    it('un BANNED archivado vuelve a BANNED, NO a ACTIVE', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('baneado', 'BANNED');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({ note: 'Pidió irse estando inhabilitado' })
        .expect(200);

      const archivado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(archivado.status).toBe(UserStatus.ARCHIVED);
      expect(archivado.statusBeforeArchive).toBe(UserStatus.BANNED);

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unarchive`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.BANNED); // ← el ban NO se ha lavado
      expect(tras.status).not.toBe(UserStatus.ACTIVE);
      // Y sigue sin poder entrar, que es la consecuencia observable.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(403);
    });

    it('un SUSPENDED archivado vuelve a SUSPENDED', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('suspendido', 'SUSPENDED');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unarchive`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
        UserStatus.SUSPENDED,
      );
    });

    it('un ACTIVE archivado vuelve a ACTIVE y puede entrar otra vez', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('vuelve');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unarchive`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ACTIVE);
      // §4.2 — los metadatos viven con ARCHIVED y se limpian al salir.
      expect(tras.archivedAt).toBeNull();
      expect(tras.archiveReason).toBeNull();
      expect(tras.archivedById).toBeNull();
      expect(tras.archiveNote).toBeNull();
      expect(tras.statusBeforeArchive).toBeNull();

      await tokenDe(user.email); // entra: 200 o el helper revienta
    });

    it('no se puede desarchivar una cuenta que no está archivada', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('no-archivado');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unarchive`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 3 — los anuncios vuelven respetando el cupo
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 3 — al desarchivar, el cupo manda', () => {
    /**
     * Reactivar saltándose la cuota sería un agujero en el límite de activos
     * abierto por una operación de OTRO dominio. Se baja el tope a 2 y se archiva
     * a alguien con 3 anuncios activos: al volver caben dos.
     */
    it('vuelven los que caben; lo que excede el cupo se queda PAUSED, y la marca se limpia en los dos casos', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('cupo');
      await crearAnuncio(user.id, 'ACTIVE', 'c1');
      await crearAnuncio(user.id, 'ACTIVE', 'c2');
      await crearAnuncio(user.id, 'ACTIVE', 'c3');

      const previo = await prisma.setting.findUnique({ where: { key: FREE_ACTIVE_LIMIT_SETTING } });
      await prisma.setting.upsert({
        where: { key: FREE_ACTIVE_LIMIT_SETTING },
        create: { key: FREE_ACTIVE_LIMIT_SETTING, value: 2 },
        update: { value: 2 },
      });

      try {
        await request(app.getHttpServer())
          .patch(`/api/admin/users/${user.id}/archive`)
          .set('Authorization', `Bearer ${modToken}`)
          .send({})
          .expect(200);

        expect(
          await prisma.listing.count({
            where: { sellerId: user.id, pausedByAccountReason: ListingPauseOrigin.ARCHIVE },
          }),
        ).toBe(3);

        const res = await request(app.getHttpServer())
          .patch(`/api/admin/users/${user.id}/unarchive`)
          .set('Authorization', `Bearer ${modToken}`)
          .expect(200);

        expect(res.body.anunciosReactivados).toBe(2);
        expect(res.body.anunciosSinCupo).toBe(1);

        expect(
          await prisma.listing.count({
            where: { sellerId: user.id, status: ListingStatus.ACTIVE },
          }),
        ).toBe(2);
        expect(
          await prisma.listing.count({
            where: { sellerId: user.id, status: ListingStatus.PAUSED },
          }),
        ).toBe(1);

        // La marca describe un ciclo de archivado que ya terminó: se limpia en los
        // dos casos, quepa o no. Lo que no cupo se queda PAUSED, y de ahí puede
        // salir el propio vendedor cuando haga sitio.
        expect(
          await prisma.listing.count({
            where: { sellerId: user.id, pausedByAccountReason: { not: null } },
          }),
        ).toBe(0);
      } finally {
        if (previo) {
          await prisma.setting.update({
            where: { key: FREE_ACTIVE_LIMIT_SETTING },
            data: { value: previo.value as Prisma.InputJsonValue },
          });
        } else {
          await prisma.setting.delete({ where: { key: FREE_ACTIVE_LIMIT_SETTING } });
        }
      }
    });

    it('un anuncio que el VENDEDOR había pausado por su cuenta NO se reactiva al desarchivar', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('pausa-propia');
      const suyo = await crearAnuncio(user.id, 'PAUSED', 'pausado-por-el');
      const activo = await crearAnuncio(user.id, 'ACTIVE', 'activo-suyo');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unarchive`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      // Ésta es la razón entera de que la marca exista: sin ella, desarchivar
      // reactivaría un anuncio que su dueño había decidido pausar.
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: suyo.id } })).status).toBe(
        ListingStatus.PAUSED,
      );
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: activo.id } })).status).toBe(
        ListingStatus.ACTIVE,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 4 — la suscripción
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 4 — a quien se fue no se le sigue cobrando', () => {
    /**
     * El efecto externo más peligroso del cuerpo: ninguna clave ajena impide que
     * una cuenta archivada con Pro siga pagando, y ningún cron lo nota.
     *
     * ── POR QUÉ ESTE TEST PAUSA LA COLA ──────────────────────────────────────
     *
     * La primera versión leía la cola sin más y **contaba los jobs**. Pasó en
     * local y en la rama, y falló en `main`: `Expected: 1, Received: 0`. No fue
     * mala suerte — era una carrera que este test perdía a veces:
     *
     *   1. `archive()` encola el job;
     *   2. el worker de facturación, que está VIVO en e2e, lo coge y lo completa
     *      (sin suscripciones no hay nada que cancelar, así que termina enseguida);
     *   3. `QUEUE_BILLING` se registra con `RETRY_JOB_OPTIONS`, que lleva
     *      **`removeOnComplete: true`** → el job se BORRA;
     *   4. el test lee la cola y no encuentra nada.
     *
     * Reproducido en local metiendo 2,5 s antes de la lectura: el conteo cae a 0
     * siempre. Es exactamente el defecto que quedó anotado en `helpers/queue.ts`
     * al arreglar el `TypeError` de `getJobs` — «contar jobs sigue siendo
     * intrínsecamente racy»— y este test lo repitió.
     *
     * `pause()` lo cierra de raíz: la pausa vive en Redis, así que **ningún**
     * worker consume mientras dure, y el job se queda en `waiting` esperando a
     * que se le lea. El `finally` la levanta pase lo que pase; sin él, las suites
     * siguientes se quedarían con la cola de facturación parada.
     */
    it('archivar encola la cancelación de suscripciones en la cola de facturación', async () => {
      await billingQueue.pause();
      try {
        const user = await crearUsuario('con-pro');
        const token = await tokenDe(user.email);

        await request(app.getHttpServer())
          .post('/api/users/me/archive')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(200);

        // `getExistingJobs` y no `getJobs` a pelo: es el helper que existe porque
        // `getJobs` puede devolver huecos. El test original tampoco lo usaba.
        const jobs = await getExistingJobs(billingQueue, ESTADOS_EN_VUELO);
        const mios = jobs.filter(
          (j) =>
            j.name === BILLING_JOB.CANCEL_SUBSCRIPTIONS &&
            (j.data as { userId?: string })?.userId === user.id,
        );
        expect(mios).toHaveLength(1);
      } finally {
        await billingQueue.resume();
      }
    });

    /**
     * Y LO QUE DE VERDAD PROTEGE EL DINERO: que la cancelación **marque las
     * filas**. Encolar un job que no hiciera nada pasaría el test de arriba y
     * dejaría al usuario pagando igual.
     *
     * Se llama al servicio directamente y se sustituye el cliente de Stripe: la
     * clave de test es real, así que una llamada de verdad saldría a la red y
     * fallaría con una suscripción inventada. Es el único punto de caja blanca de
     * esta suite, y está aquí porque la alternativa —no probarlo— deja sin
     * barrera justo el paso que evita el cobro.
     */
    it('cancelActiveSubscriptionsFor marca las suscripciones vivas como CANCELING, y es idempotente', async () => {
      const user = await crearUsuario('cancelar');
      const price = await prisma.price.findFirstOrThrow({
        where: { product: { type: 'RECURRING' } },
        select: { id: true },
      });
      const sub = await prisma.subscription.create({
        data: {
          userId: user.id,
          priceId: price.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
          gatewaySubscriptionId: `sub_c2_${user.id}`,
        },
      });

      const billing = app.get(BillingService);
      const update = jest.fn().mockResolvedValue({});
      const original = (billing as unknown as { _stripe?: unknown })._stripe;
      (billing as unknown as { _stripe: unknown })._stripe = { subscriptions: { update } };

      try {
        expect(await billing.cancelActiveSubscriptionsFor(user.id)).toBe(1);

        const tras = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
        expect(tras.status).toBe('CANCELING');
        expect(tras.cancelAtPeriodEnd).toBe(true);
        expect(update).toHaveBeenCalledWith(sub.gatewaySubscriptionId, {
          cancel_at_period_end: true,
        });

        // IDEMPOTENTE: lo llama un job con reintentos, así que ejecutarlo dos
        // veces no puede reventar ni volver a tocar la pasarela.
        update.mockClear();
        expect(await billing.cancelActiveSubscriptionsFor(user.id)).toBe(0);
        expect(update).not.toHaveBeenCalled();
      } finally {
        (billing as unknown as { _stripe: unknown })._stripe = original;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  La ficha del backoffice
  // ═══════════════════════════════════════════════════════════════════════════

  describe('La ficha del staff cuenta el archivado entero', () => {
    it('sirve cuándo, por qué, quién y A DÓNDE volvería', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('ficha', 'BANNED');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({ note: 'Lo pidió por soporte' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/admin/users/${user.id}`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      expect(res.body.status).toBe('ARCHIVED');
      expect(res.body.archiveReason).toBe('STAFF_ACTION');
      expect(res.body.archiveNote).toBe('Lo pidió por soporte');
      expect(res.body.archivedAt).toEqual(expect.any(String));
      expect(res.body.archivedBy).toMatchObject({ name: 'C2 Moderador' });
      // Un botón «Desarchivar» que no dijera que devuelve a BANNED sería una trampa.
      expect(res.body.statusBeforeArchive).toBe('BANNED');
    });

    it('la lista de usuarios se puede filtrar por ARCHIVED', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('listado');
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/archive`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/admin/users?status=ARCHIVED')
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      const ids = (res.body.items as { id: string }[]).map((u) => u.id);
      expect(ids).toContain(user.id);
      for (const u of res.body.items as { status: string }[]) {
        expect(u.status).toBe('ARCHIVED');
      }
    });
  });
});
