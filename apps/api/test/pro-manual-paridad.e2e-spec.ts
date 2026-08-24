/**
 * PARIDAD DEL PRO MANUAL — LOS DOS EJES, Y QUE LA INTERFAZ PUEDA DISTINGUIRLOS.
 *
 * LA CAUSA COMÚN DE LOS DOS HUECOS de §1.5: el frontend fundía «es Pro» y «tiene una
 * suscripción de pago» en un solo `isPro`. El backend nunca los confundió —las ventajas van
 * por `Entitlement` (`isProActive`) y el guard del checkout mira `Subscription`— pero sólo
 * publicaba uno de los dos ejes, así que la interfaz no tenía con qué distinguirlos:
 *
 *   · `/perfil/suscripcion` dejaba en blanco al Pro concedido a mano;
 *   · `/planes` le decía «Ya eres Pro» y le impedía pagar… **algo que el servidor sí
 *     aceptaba**.
 *
 * Lo que se fija aquí es el contrato que hace posible el arreglo: que `pro-status` publique
 * los dos ejes, y —lo que de verdad importa— que el eje nuevo diga EXACTAMENTE lo que el
 * guard del checkout va a hacer. Una interfaz que ofrece lo que el servidor rechaza (o
 * esconde lo que aceptaría) es el defecto, no el síntoma.
 *
 * Ver docs/auditoria-pro-video.md §1.5.
 */
import { INestApplication } from '@nestjs/common';
import { EntitlementType, PrismaClient, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const EN_30_DIAS = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

describe('Paridad del Pro manual — los dos ejes de `pro-status` (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let priceProId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    // El precio recurrente del plan Pro, para pedirle un checkout al guard.
    const precio = await prisma.price.findFirst({
      where: { product: { type: 'RECURRING' }, active: true },
      select: { id: true },
    });
    priceProId = precio!.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Crea un usuario y devuelve su id y su token. */
  async function crearUsuario(sufijo: string) {
    const user = await prisma.user.create({
      data: {
        email: `paridad-${sufijo}@example.com`,
        name: `Paridad ${sufijo}`,
        slug: `paridad-${sufijo}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
      select: { id: true },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `paridad-${sufijo}@example.com`, password: 'Test1234!' });
    return { id: user.id, token: login.body.accessToken as string };
  }

  /** Pro CONCEDIDO: un entitlement sin `subscriptionId`. Es la marca de procedencia. */
  function concederProAMano(userId: string) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: null,
        expiresAt: EN_30_DIAS(),
      },
    });
  }

  /** Pro DE PAGO: una Subscription y su entitlement colgando de ella. */
  async function suscribirDeVerdad(userId: string, status: SubscriptionStatus) {
    const sub = await prisma.subscription.create({
      data: {
        userId,
        priceId: priceProId,
        status,
        currentPeriodStart: new Date(),
        currentPeriodEnd: EN_30_DIAS(),
        gatewaySubscriptionId: `sub_${userId}_${status}`,
      },
      select: { id: true },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: sub.id,
        expiresAt: EN_30_DIAS(),
      },
    });
    return sub.id;
  }

  async function proStatus(token: string) {
    const res = await request(app.getHttpServer())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as { isPro: boolean; hasActiveSubscription: boolean; quotaSource: string };
  }

  /** Intenta abrir el checkout del plan. 201 = el servidor lo acepta. */
  function pedirCheckout(token: string) {
    return request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ priceId: priceProId });
  }

  // ── BARRERA: los dos ejes se publican, y dicen cosas distintas ─────────────

  it('un NO-Pro: los dos ejes en false', async () => {
    const { token } = await crearUsuario('nadie');

    const estado = await proStatus(token);
    expect(estado.isPro).toBe(false);
    expect(estado.hasActiveSubscription).toBe(false);
  });

  it('un Pro CONCEDIDO: es Pro y NO tiene suscripción — los dos ejes DIVERGEN', async () => {
    // El caso entero, en dos booleanos. Antes sólo se publicaba el primero, así que la
    // interfaz no podía saber que este usuario es Pro sin haber pagado.
    const { id, token } = await crearUsuario('concedido');
    await concederProAMano(id);

    const estado = await proStatus(token);
    expect(estado.isPro).toBe(true);
    expect(estado.hasActiveSubscription).toBe(false);
    // Y sigue sin cuota mensual, que es correcto y ya estaba fijado (D-1): las gratuidades
    // cuelgan de un ciclo de facturación que aquí no existe.
    expect(estado.quotaSource).toBe('NONE');
  });

  it('y `my-entitlements` sirve la PROCEDENCIA, que es lo que la página necesita', async () => {
    // El eslabón que `/perfil/suscripcion` da por hecho para elegir su rama: sin
    // `subscriptionId` en el payload no puede distinguir un Pro concedido de uno de pago, y
    // la interfaz volvería a adivinar. Se comprueba aquí porque es un contrato de la API,
    // no del componente.
    const { id, token } = await crearUsuario('procedencia');
    await concederProAMano(id);

    const res = await request(app.getHttpServer())
      .get('/api/billing/my-entitlements')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const pro = (res.body as { type: string; subscriptionId: string | null; expiresAt: string }[])
      .find((e) => e.type === 'PRO_SUBSCRIPTION');
    expect(pro).toBeDefined();
    expect(pro!.subscriptionId).toBeNull();
    expect(pro!.expiresAt).toBeTruthy();
  });

  it('un Pro DE PAGO: los dos ejes en true — para él nada cambia', async () => {
    const { id, token } = await crearUsuario('pagando');
    await suscribirDeVerdad(id, SubscriptionStatus.ACTIVE);

    const estado = await proStatus(token);
    expect(estado.isPro).toBe(true);
    expect(estado.hasActiveSubscription).toBe(true);
    expect(estado.quotaSource).toBe('SUBSCRIPTION');
  });

  it('CANCELING cuenta como suscripción viva: sigue pagando hasta fin de periodo', async () => {
    const { id, token } = await crearUsuario('cancelando');
    await suscribirDeVerdad(id, SubscriptionStatus.CANCELING);

    expect((await proStatus(token)).hasActiveSubscription).toBe(true);
  });

  it('PAST_DUE NO cuenta: el cobro falló y hay que dejarle rehacerlo', async () => {
    // El matiz que hace que este eje NO se pueda derivar de `quotaSource`: ahí una PAST_DUE
    // diría «SUBSCRIPTION», y el guard —que la deja pasar a propósito— diría lo contrario.
    const { id, token } = await crearUsuario('impagado');
    await suscribirDeVerdad(id, SubscriptionStatus.PAST_DUE);

    const estado = await proStatus(token);
    expect(estado.hasActiveSubscription).toBe(false);
  });

  // ── BARRERA: coherencia UI/backend ─────────────────────────────────────────

  describe('el eje nuevo dice EXACTAMENTE lo que el guard del checkout hará', () => {
    it('al Pro CONCEDIDO el servidor le deja pagar — por eso la interfaz debe ofrecérselo', async () => {
      const { id, token } = await crearUsuario('concedido-paga');
      await concederProAMano(id);

      // `hasActiveSubscription: false` → el botón se pinta habilitado…
      expect((await proStatus(token)).hasActiveSubscription).toBe(false);

      // …y el servidor, efectivamente, NO lo rechaza con ALREADY_SUBSCRIBED. (Sin claves de
      // Stripe en el entorno de pruebas la sesión no llega a crearse, así que lo que se
      // comprueba es que el guard NO es quien corta: cualquier respuesta menos ese código.)
      const res = await pedirCheckout(token);
      expect(res.body?.code).not.toBe('ALREADY_SUBSCRIBED');
    });

    it('al Pro DE PAGO el servidor se lo impide — y la interfaz también', async () => {
      const { id, token } = await crearUsuario('pagando-repite');
      await suscribirDeVerdad(id, SubscriptionStatus.ACTIVE);

      expect((await proStatus(token)).hasActiveSubscription).toBe(true);

      const res = await pedirCheckout(token).expect(400);
      expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    });

    it('REQUISITO DE ORO — el eje y el guard nunca se contradicen', async () => {
      // El barrido sobre los cuatro estados posibles: para cada uno, lo que dice
      // `hasActiveSubscription` tiene que ser exactamente lo que hace el guard. Es la
      // invariante que justifica compartir el predicado (`suscripcionVigenteFilter`) en vez
      // de escribirlo dos veces.
      const casos: { sufijo: string; preparar: (id: string) => Promise<unknown> }[] = [
        { sufijo: 'oro-nadie', preparar: async () => undefined },
        { sufijo: 'oro-concedido', preparar: (id) => concederProAMano(id) },
        { sufijo: 'oro-activa', preparar: (id) => suscribirDeVerdad(id, SubscriptionStatus.ACTIVE) },
        {
          sufijo: 'oro-cancelando',
          preparar: (id) => suscribirDeVerdad(id, SubscriptionStatus.CANCELING),
        },
        {
          sufijo: 'oro-impagado',
          preparar: (id) => suscribirDeVerdad(id, SubscriptionStatus.PAST_DUE),
        },
      ];

      for (const { sufijo, preparar } of casos) {
        const { id, token } = await crearUsuario(sufijo);
        await preparar(id);

        const { hasActiveSubscription } = await proStatus(token);
        const res = await pedirCheckout(token);
        const guardCorta = res.body?.code === 'ALREADY_SUBSCRIBED';

        expect([sufijo, hasActiveSubscription]).toEqual([sufijo, guardCorta]);
      }
    });
  });
});
