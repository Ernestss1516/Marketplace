/**
 * CUOTAS PRO — PIEZA 2: LA CUOTA DEL PRO CONCEDIDO A MANO, PROPIA Y CONFIGURABLE.
 *
 * ─── QUÉ ABRE ────────────────────────────────────────────────────────────────────
 *
 * Un Pro concedido desde el backoffice (`grantPro` → `Entitlement` con
 * `subscriptionId: null`) tenía todas las capacidades de Pro y ninguna de las gratuidades
 * mensuales, porque la cuota colgaba de un ciclo de facturación que él no tiene. La pieza 1
 * quitó esa dependencia —la ventana pasó a ser el MES NATURAL, que no necesita ciclo—, y
 * esta pieza usa ese mecanismo para darle cuota propia: dos ajustes suyos en
 * `/admin/ajustes`, independientes de los del plan de pago (decisión D-6).
 *
 * ─── LO QUE MÁS HAY QUE VIGILAR NO ES LA FUNCIÓN NUEVA, ES LA VIEJA ──────────────
 *
 * Esto es facturación, y lo que da valor a alguien puede quitárselo a otro. Las dos barreras
 * que de verdad importan aquí son de NO-CAMBIO:
 *
 *   · **B2 — con los ajustes por defecto (0), el manual se comporta EXACTAMENTE como antes.**
 *     Nada se regala salvo que Ernest lo decida. Y no basta con que `remaining` sea 0: la
 *     respuesta tiene que seguir diciendo `quotaSource: 'NONE'`, porque con `'MANUAL'` y
 *     ceros `/mis-anuncios` le escribiría «Has usado tus destacados gratis de este mes» sobre
 *     unos que nunca tuvo.
 *   · **D-8 — un cliente que PAGA y además tiene una concesión a mano cobra la del PLAN.**
 *     Es la corrección de U1, y esta pieza la pone en peligro de una forma nueva: si ganara
 *     el manual, al cliente de pago le cambiarían su cuota por la del manual, que por defecto
 *     es CERO. Hacerle un favor le quitaría lo que compró.
 *
 * Ver docs/auditoria-y-diseno-cuotas-pro.md §8.3 y §9.
 */

import { INestApplication } from '@nestjs/common';
import {
  BumpLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  PrismaClient,
  ProductType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { fijarAjuste, preservarAjustes } from './helpers/settings';
import { EntitlementService } from 'src/modules/billing/entitlement.service';

const CLAVE_DESTACADOS = 'proManualMonthlyFeaturedQuota';
const CLAVE_BUMPS = 'proManualMonthlyBumpQuota';

describe('Cuotas Pro pieza 2 — la cuota del Pro concedido a mano (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  const server = () => app.getHttpServer();

  // El objeto de estudio SON estos ajustes: cada caso pone el suyo. La red de abajo
  // garantiza que al acabar la suite las claves vuelven a su sitio (aquí, a no existir)
  // pase lo que pase — `Setting` es un fixture global que `cleanDb` no toca.
  preservarAjustes([CLAVE_DESTACADOS, CLAVE_BUMPS]);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const categoria = await prisma.category.findFirst({ select: { id: true } });
    if (!categoria) throw new Error('No hay categorías sembradas — run seed-test.ts');
    categoryId = categoria.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function crearUsuario(sufijo: string) {
    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const user = await prisma.user.create({
      data: {
        email: `manual-${sufijo}@example.com`,
        name: `Manual ${sufijo}`,
        slug: `manual-${sufijo}`,
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

  /** Un Pro CONCEDIDO A MANO: el molde exacto de `AdminBillingService.grantPro`. */
  async function proConcedidoAMano(userId: string) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        // LA MARCA. No hay columna `source`: esto ES la procedencia.
        subscriptionId: null,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /** Un Pro DE PAGO, para los casos de convivencia. */
  async function proDePago(userId: string) {
    const price = await prisma.price.findFirstOrThrow({
      where: { product: { type: ProductType.RECURRING } },
      select: { id: true },
    });
    const finDelCiclo = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId: price.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: finDelCiclo,
        gatewaySubscriptionId: `sub_manual_${userId}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId: price.id,
        expiresAt: finDelCiclo,
      },
    });
  }

  async function anuncioActivo(userId: string, sufijo: string) {
    return prisma.listing.create({
      data: {
        title: `Manual ${sufijo}`,
        slug: `manual-${sufijo}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: ListingStatus.ACTIVE,
        sellerId: userId,
        categoryId,
      },
    });
  }

  interface EstadoPro {
    isPro: boolean;
    limit: number;
    used: number;
    remaining: number;
    periodStart?: string;
    periodEnd?: string;
    quotaSource: string;
    hasActiveSubscription: boolean;
    bumpQuota: { limit: number; used: number; remaining: number };
  }

  async function estadoPro(token: string): Promise<EstadoPro> {
    const res = await request(server())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as EstadoPro;
  }

  async function cuotaManual(destacados: number, bumps: number) {
    await fijarAjuste(prisma, CLAVE_DESTACADOS, destacados);
    await fijarAjuste(prisma, CLAVE_BUMPS, bumps);
  }

  /** Borra las dos filas: el estado POR DEFECTO, que es «sin configurar». */
  async function sinCuotaManualConfigurada() {
    await prisma.setting.deleteMany({ where: { key: { in: [CLAVE_DESTACADOS, CLAVE_BUMPS] } } });
  }

  // ---------------------------------------------------------------------------
  // BARRERA 2 — la retrocompatibilidad, primero (es la que protege lo que ya había)
  // ---------------------------------------------------------------------------

  describe('BARRERA 2 — por defecto NO cambia nada', () => {
    it('un Pro concedido a mano, sin los ajustes configurados, sigue SIN cuota', async () => {
      await sinCuotaManualConfigurada();
      const { user, token } = await crearUsuario('b2-defecto');
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      // Es Pro —eso nunca estuvo en duda— y no tiene cuota. Las dos cosas por su nombre.
      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('NONE');
      expect(estado.limit).toBe(0);
      expect(estado.bumpQuota.limit).toBe(0);
      // Sin ventana: no hay nada que caducar, así que el aviso de caducidad no tiene de
      // dónde agarrarse (su segunda puerta, en cuota-caducidad.ts).
      expect(estado.periodStart).toBeUndefined();
      expect(estado.periodEnd).toBeUndefined();
      // Y el otro eje sigue diciendo la verdad: no paga nada, así que puede suscribirse.
      expect(estado.hasActiveSubscription).toBe(false);
    });

    it('y con los ajustes puestos a 0 explícitamente, tampoco — 0 es «sin cuota», no «cuota de cero»', async () => {
      await cuotaManual(0, 0);
      const { user, token } = await crearUsuario('b2-ceros');
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      // `NONE` y no `MANUAL`: con `MANUAL` y ceros, /mis-anuncios le escribiría «Has usado
      // tus destacados gratis de este mes» sobre unos que nunca tuvo.
      expect(estado.quotaSource).toBe('NONE');
      expect(estado.remaining).toBe(0);
      expect(estado.bumpQuota.remaining).toBe(0);
    });

    it('un usuario que no es Pro de ninguna forma sigue igual, con la cuota manual encendida', async () => {
      await cuotaManual(5, 5);
      const { token } = await crearUsuario('b2-nopro');

      const estado = await estadoPro(token);

      // La cuota manual es de los Pro concedidos a mano, no de cualquiera.
      expect(estado.isPro).toBe(false);
      expect(estado.quotaSource).toBe('NONE');
      expect(estado.limit).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // BARRERA 1 — el manual con cuota configurada
  // ---------------------------------------------------------------------------

  describe('BARRERA 1 — con los ajustes por encima de 0, el manual recibe cuota', () => {
    it('recibe exactamente lo configurado, y por MES NATURAL', async () => {
      await cuotaManual(3, 2);
      const { user, token } = await crearUsuario('b1-concuota');
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('MANUAL');
      expect(estado.limit).toBe(3);
      expect(estado.remaining).toBe(3);
      expect(estado.bumpQuota.limit).toBe(2);
      expect(estado.bumpQuota.remaining).toBe(2);

      // LA VENTANA ES LA MISMA QUE LA DE QUIEN PAGA: el mes natural (pieza 1). Es la
      // conexión entre las dos piezas — sin ella, el manual no tendría desde cuándo contar.
      expect(estado.periodStart).toBeTruthy();
      expect(new Date(estado.periodStart!).getTime()).toBeLessThanOrEqual(Date.now());
      expect(new Date(estado.periodEnd!).getTime()).toBeGreaterThan(Date.now());
      const dias =
        (new Date(estado.periodEnd!).getTime() - new Date(estado.periodStart!).getTime()) /
        86_400_000;
      expect(dias).toBeGreaterThan(27.9);
      expect(dias).toBeLessThan(31.1);
    });

    it('lo gastado este mes le descuenta; lo del mes pasado, no', async () => {
      await cuotaManual(3, 2);
      const { user, token } = await crearUsuario('b1-gastado');
      await proConcedidoAMano(user.id);

      const { periodStart } = await estadoPro(token);
      const inicioDelMes = new Date(periodStart!).getTime();

      const deEsteMes = await anuncioActivo(user.id, 'b1-hoy');
      const delMesPasado = await anuncioActivo(user.id, 'b1-ayer');
      await prisma.entitlement.createMany({
        data: [
          {
            userId: user.id,
            type: EntitlementType.FEATURED_LISTING,
            listingId: deEsteMes.id,
            origin: FeaturedOrigin.PRO_QUOTA,
            createdAt: new Date(inicioDelMes + 1_000),
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
          {
            userId: user.id,
            type: EntitlementType.FEATURED_LISTING,
            listingId: delMesPasado.id,
            origin: FeaturedOrigin.PRO_QUOTA,
            createdAt: new Date(inicioDelMes - 1_000),
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        ],
      });

      const estado = await estadoPro(token);

      expect(estado.used).toBe(1);
      expect(estado.remaining).toBe(2);
    });

    it('una sola de las dos bolsas puede estar configurada — son ajustes independientes', async () => {
      await cuotaManual(0, 4);
      const { user, token } = await crearUsuario('b1-soloBumps');
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      // Con una de las dos por encima de 0 ya hay cuota que contar.
      expect(estado.quotaSource).toBe('MANUAL');
      expect(estado.limit).toBe(0);
      expect(estado.bumpQuota.limit).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // D-8 — quien paga no pierde nada por recibir además una cortesía
  // ---------------------------------------------------------------------------

  describe('D-8 — el plan de pago gana al Pro concedido a mano', () => {
    it('un cliente de pago CON una concesión a mano encima cobra la cuota del PLAN', async () => {
      // La trampa: el manual se concede DESPUÉS, así que es el más reciente. Con un
      // `orderBy` ingenuo ganaría él — y con la cuota manual a 0, al cliente de pago le
      // habríamos quitado su cuota por hacerle un favor.
      await cuotaManual(0, 0);
      const { user, token } = await crearUsuario('d8-pago-y-manual');
      await proDePago(user.id);
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      expect(estado.quotaSource).toBe('SUBSCRIPTION');
      expect(estado.limit).toBe(4);
      expect(estado.bumpQuota.limit).toBe(4);
    });

    it('y tampoco se SUMAN: una cortesía no es un acumulable', async () => {
      await cuotaManual(9, 9);
      const { user, token } = await crearUsuario('d8-no-suma');
      await proDePago(user.id);
      await proConcedidoAMano(user.id);

      const estado = await estadoPro(token);

      expect(estado.limit).toBe(4);
      expect(estado.bumpQuota.limit).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // BARRERA 5 — la cascada y el bump, para el manual con cuota
  // ---------------------------------------------------------------------------

  describe('BARRERA 5 — el manual con cuota la GASTA de verdad', () => {
    it('destacar por cuota funciona, y descuenta', async () => {
      await cuotaManual(2, 2);
      const { user, token } = await crearUsuario('b5-destacar');
      await proConcedidoAMano(user.id);
      const anuncio = await anuncioActivo(user.id, 'b5-destacar');

      const res = await request(server())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: anuncio.id, useQuota: true })
        .expect(201);

      expect(res.body.viaQuota).toBe(true);
      const concedido = await prisma.entitlement.findFirst({
        where: { listingId: anuncio.id, type: EntitlementType.FEATURED_LISTING },
        select: { origin: true },
      });
      expect(concedido?.origin).toBe(FeaturedOrigin.PRO_QUOTA);

      const estado = await estadoPro(token);
      expect(estado.used).toBe(1);
      expect(estado.remaining).toBe(1);
    });

    it('el bump entra por la CASCADA en su nivel 1: cuota antes que saldo y que créditos', async () => {
      await cuotaManual(2, 1);
      const { user, token } = await crearUsuario('b5-bump');
      await proConcedidoAMano(user.id);
      // Con saldo de bumps Y créditos disponibles: si la cuota no entrara primero, el bump
      // se pagaría con una de las otras dos bolsas y el caso lo vería.
      await prisma.wallet.upsert({
        where: { userId: user.id },
        create: { userId: user.id, balance: 500, bumpBalance: 5 },
        update: { balance: 500, bumpBalance: 5 },
      });
      const anuncio = await anuncioActivo(user.id, 'b5-bump');

      const res = await request(server())
        .post(`/api/listings/${anuncio.id}/bump`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.paidWith).toBe('PRO_QUOTA');

      // Y no se tocó ninguna de las otras dos bolsas.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(wallet.balance).toBe(500);
      expect(wallet.bumpBalance).toBe(5);

      const estado = await estadoPro(token);
      expect(estado.bumpQuota.remaining).toBe(0);
    });

    it('agotada la cuota, la reserva la RECHAZA — el límite se aplica, no sólo se enseña', async () => {
      await cuotaManual(1, 1);
      const { user, token } = await crearUsuario('b5-agotada');
      await proConcedidoAMano(user.id);

      const primero = await anuncioActivo(user.id, 'b5-uno');
      await request(server())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: primero.id, useQuota: true })
        .expect(201);

      const segundo = await anuncioActivo(user.id, 'b5-dos');
      await request(server())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: segundo.id, useQuota: true })
        .expect(400);
    });

    it('y con los ajustes a 0 NO puede gastar cuota: la reserva dice que no', async () => {
      await cuotaManual(0, 0);
      const { user, token } = await crearUsuario('b5-sincuota');
      await proConcedidoAMano(user.id);
      const anuncio = await anuncioActivo(user.id, 'b5-sincuota');

      await request(server())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: anuncio.id, useQuota: true })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // BARRERA 4 — el cerrojo de la pieza 1 cubre al manual
  // ---------------------------------------------------------------------------

  describe('BARRERA 4 — la reserva del manual también es atómica', () => {
    /**
     * EL CERROJO NO SE TOCÓ EN ESTA PIEZA, y éste es el caso que lo demuestra. La pieza 1 lo
     * mudó de la fila `Subscription` a la del `Entitlement` precisamente porque el Pro
     * concedido a mano no tiene la primera: se hizo antes de necesitarlo, con los tests de
     * carrera del plan de pago vigilando. Aquí se cobra esa decisión.
     *
     * Sin cerrojo, las dos peticiones leerían `remaining = 1` antes de que ninguna escriba y
     * ambas concederían un destacado gratis con cupo para uno.
     */
    it('dos destacados por cuota simultáneos con cupo para uno: sólo pasa UNO', async () => {
      await cuotaManual(1, 1);
      const { user, token } = await crearUsuario('b4-carrera');
      await proConcedidoAMano(user.id);
      const a = await anuncioActivo(user.id, 'b4-a');
      const b = await anuncioActivo(user.id, 'b4-b');

      const destacar = (listingId: string) =>
        request(server())
          .post('/api/billing/featured-by-credits')
          .set('Authorization', `Bearer ${token}`)
          .send({ listingId, useQuota: true });

      const [resA, resB] = await Promise.all([destacar(a.id), destacar(b.id)]);
      const creados = [resA.status, resB.status].filter((s) => s === 201);

      expect(creados).toHaveLength(1);

      const porCuota = await prisma.entitlement.count({
        where: {
          userId: user.id,
          type: EntitlementType.FEATURED_LISTING,
          origin: FeaturedOrigin.PRO_QUOTA,
        },
      });
      expect(porCuota).toBe(1);
    });

    /**
     * El de arriba puede pasar por casualidad si Postgres resuelve tan rápido que las dos
     * peticiones nunca llegan a solaparse — es la lección que dejó escrita la suite del plan
     * de pago. Este fuerza el solape: envuelve la reserva REAL con un retardo metido DESPUÉS
     * de coger el cerrojo y ANTES de que la transacción confirme.
     */
    it('y con el solape FORZADO, el segundo espera al primero de verdad', async () => {
      await cuotaManual(1, 1);
      const { user, token } = await crearUsuario('b4-carrera-det');
      await proConcedidoAMano(user.id);
      const a = await anuncioActivo(user.id, 'b4d-a');
      const b = await anuncioActivo(user.id, 'b4d-b');

      const entitlements = app.get(EntitlementService);
      const original = entitlements.hasAvailableFeaturedQuota.bind(entitlements);
      let retrasadoUnaVez = false;
      const spy = jest
        .spyOn(entitlements, 'hasAvailableFeaturedQuota')
        .mockImplementation(async (tx, uid) => {
          const resultado = await original(tx, uid);
          if (!retrasadoUnaVez) {
            retrasadoUnaVez = true;
            await new Promise((r) => setTimeout(r, 300));
          }
          return resultado;
        });

      try {
        const destacar = (listingId: string) =>
          request(server())
            .post('/api/billing/featured-by-credits')
            .set('Authorization', `Bearer ${token}`)
            .send({ listingId, useQuota: true });

        const [resA, resB] = await Promise.all([destacar(a.id), destacar(b.id)]);

        expect([resA.status, resB.status].filter((s) => s === 201)).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('lo mismo con los bumps, que cuelgan del MISMO entitlement', async () => {
      await cuotaManual(1, 1);
      const { user, token } = await crearUsuario('b4-bumps');
      await proConcedidoAMano(user.id);
      const a = await anuncioActivo(user.id, 'b4-bump-a');
      const b = await anuncioActivo(user.id, 'b4-bump-b');

      const bump = (listingId: string) =>
        request(server())
          .post(`/api/listings/${listingId}/bump`)
          .set('Authorization', `Bearer ${token}`);

      await Promise.all([bump(a.id), bump(b.id)]);

      const porCuota = await prisma.bumpLedger.count({
        where: { type: BumpLedgerType.PRO_QUOTA, wallet: { userId: user.id } },
      });
      expect(porCuota).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // BARRERA 3 — configurable de verdad, desde el endpoint real de admin
  // ---------------------------------------------------------------------------

  describe('BARRERA 3 — los dos ajustes son configurables y admiten 0', () => {
    async function tokenDeAdmin(): Promise<string> {
      const email = 'manual-admin@example.com';
      await prisma.user.create({
        data: {
          email,
          name: 'Manual admin',
          slug: 'manual-admin',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
          role: 'ADMIN',
        },
      });
      // Los administradores entran por SU puerta, no por la general: `admin-login` tiene
      // su propio límite por IP (20 por ventana, frente a 150). Usar `/auth/login` aquí
      // devuelve un token que el guard de admin no acepta — 401 en todos los casos.
      const res = await request(server())
        .post('/api/auth/admin-login')
        .send({ email, password: 'Test1234!' });
      return res.body.accessToken as string;
    }

    let adminToken: string;
    beforeAll(async () => {
      adminToken = await tokenDeAdmin();
    });

    const guardar = (token: string, key: string, value: unknown) =>
      request(server())
        .patch(`/api/admin/settings/${key}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value });

    it('las dos claves aparecen en GET /admin/settings, con su default 0 y sin configurar', async () => {
      await sinCuotaManualConfigurada();

      const res = await request(server())
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const filas = res.body as { key: string; value: unknown; configured: boolean }[];
      for (const clave of [CLAVE_DESTACADOS, CLAVE_BUMPS]) {
        const fila = filas.find((f) => f.key === clave);
        expect(fila).toBeDefined();
        expect(fila!.value).toBe(0);
        // «Sin configurar» es un estado honesto: nadie ha decidido todavía cuánto vale
        // una concesión de cortesía, y la pantalla lo dice con esas palabras.
        expect(fila!.configured).toBe(false);
      }
    });

    it('ACEPTA el 0 — y ahí está la diferencia con las cuotas del plan de pago, que exigen >= 1', async () => {
      await guardar(adminToken, CLAVE_DESTACADOS, 0).expect(200);
      await guardar(adminToken, CLAVE_BUMPS, 0).expect(200);

      // La de pago, en cambio, lo rechaza — y debe seguir rechazándolo.
      await guardar(adminToken, 'proMonthlyFeaturedQuota', 0).expect(400);
    });

    it('rechaza negativos y decimales', async () => {
      await guardar(adminToken, CLAVE_DESTACADOS, -1).expect(400);
      await guardar(adminToken, CLAVE_BUMPS, 1.5).expect(400);
      await guardar(adminToken, CLAVE_DESTACADOS, 'tres').expect(400);
    });

    it('y cambiar el número por el endpoint real cambia lo que el usuario recibe', async () => {
      const { user, token } = await crearUsuario('b3-cambio');
      await proConcedidoAMano(user.id);

      await guardar(adminToken, CLAVE_DESTACADOS, 0).expect(200);
      expect((await estadoPro(token)).quotaSource).toBe('NONE');

      await guardar(adminToken, CLAVE_DESTACADOS, 7).expect(200);
      const despues = await estadoPro(token);

      expect(despues.quotaSource).toBe('MANUAL');
      expect(despues.limit).toBe(7);
      expect(despues.remaining).toBe(7);
    });
  });
});
