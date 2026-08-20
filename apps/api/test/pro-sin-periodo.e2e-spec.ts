/**
 * FICHA DE USUARIO — RÁFAGA U1: «ES PRO» DEJA DE DEPENDER DE TENER SUSCRIPCIÓN.
 *
 * QUÉ ARREGLA, y por qué va sola y antes que nada. Las tres funciones de cuota
 * mensual leen el mismo `Entitlement` que todo el mundo, pero piden la
 * `Subscription` para saber **desde cuándo contar** (la cuota es un COUNT desde
 * `currentPeriodStart`). Buscaban «el entitlement PRO vigente MÁS RECIENTE» y
 * comprobaban después si tenía suscripción. Con un solo entitlement eso da
 * igual; con dos, no:
 *
 *   **LA BARRERA** — a un cliente que YA PAGA se le concede un Pro manual. El
 *   manual es más nuevo y no tiene suscripción, así que ganaba el `orderBy` y su
 *   cuota mensual —la que está pagando— se quedaba a cero.
 *
 * Es decir: construir el Pro manual sin este arreglo habría metido una regresión
 * en el único camino que genera ingresos. Por eso U1 no concede nada todavía;
 * sólo deja la lógica preparada para que lo siguiente no rompa nada.
 *
 * Y el segundo defecto, más pequeño: «no hay periodo» se decía devolviendo
 * `isPro: false`. Un Pro concedido a mano tiene todas las capacidades de Pro; lo
 * único que no tiene son las gratuidades mensuales, porque cuelgan de un ciclo de
 * facturación que nadie está pagando (decisión D-1).
 *
 * Ver docs/diseno-ficha-usuario.md §0.4, §1.4 y §6 (U1).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, FeaturedOrigin, PrismaClient, ProductType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Ficha de usuario U1 — Pro sin periodo de facturación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const server = () => app.getHttpServer();

  async function crearUsuario(sufijo: string) {
    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.create({
      data: {
        email: `u1-${sufijo}@example.com`,
        name: `U1 ${sufijo}`,
        slug: `u1-${sufijo}`,
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

  async function proPriceId() {
    // El tipo vive en el Product, no en el Price — molde de `h8-featured-quota`.
    const price = await prisma.price.findFirst({
      where: { product: { type: ProductType.RECURRING } },
      select: { id: true },
    });
    if (!price) throw new Error('No hay Price RECURRING sembrado (Plan Pro)');
    return price.id;
  }

  /** Un Pro DE PAGO: Subscription + Entitlement enlazado. Molde de `ensureProEntitlement`. */
  async function proDePago(userId: string) {
    const priceId = await proPriceId();
    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gatewaySubscriptionId: `sub_u1_${userId}_${Date.now()}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId,
        expiresAt: periodEnd,
      },
    });
    return { subscription, periodStart, periodEnd };
  }

  /**
   * Un Pro SIN suscripción — exactamente la forma que tendrá el Pro manual de la
   * ráfaga siguiente. Aquí se crea a mano porque U1 **no concede nada todavía**:
   * lo que se prueba es que la lógica ya lo trata bien.
   */
  async function proSinPeriodo(userId: string, expiresAt?: Date) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: null,
        expiresAt: expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  }

  async function estadoPro(token: string) {
    const res = await request(server())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`);
    return res.body as {
      isPro: boolean;
      quotaSource: string;
      limit: number;
      used: number;
      remaining: number;
      bumpQuota: { limit: number; remaining: number };
      periodStart?: string;
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── LA BARRERA ────────────────────────────────────────────────────────────

  describe('LA BARRERA — el camino de ingresos', () => {
    it('un cliente DE PAGO con un Pro manual encima CONSERVA su cuota mensual', async () => {
      // La regresión que U1 existe para impedir. El entitlement manual es más
      // reciente y no tiene suscripción: con el `orderBy` anterior ganaba él, y
      // la cuota del cliente que está pagando se quedaba a cero.
      const { user, token } = await crearUsuario('pago-con-manual');
      await proDePago(user.id);
      await proSinPeriodo(user.id); // concedido DESPUÉS: es el más reciente

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('SUBSCRIPTION');
      expect(estado.limit).toBeGreaterThan(0);
      expect(estado.remaining).toBe(estado.limit);
      expect(estado.bumpQuota.limit).toBeGreaterThan(0);
      expect(estado.periodStart).toBeTruthy();
    });

    it('y su cuota YA CONSUMIDA se sigue contando bien', async () => {
      // No basta con que el límite aparezca: el COUNT tiene que seguir
      // haciéndose sobre el periodo del de pago.
      const { user, token } = await crearUsuario('pago-consumido');
      const { periodStart } = await proDePago(user.id);
      await proSinPeriodo(user.id);

      const categoria = await prisma.category.findFirst();
      const anuncio = await prisma.listing.create({
        data: {
          title: 'U1 consumido', slug: `u1-consumido-${Date.now()}`, description: 'x',
          price: 10, type: 'PRODUCT', status: 'ACTIVE',
          sellerId: user.id, categoryId: categoria!.id,
        },
      });
      await prisma.entitlement.create({
        data: {
          userId: user.id,
          type: EntitlementType.FEATURED_LISTING,
          listingId: anuncio.id,
          origin: FeaturedOrigin.PRO_QUOTA,
          createdAt: new Date(periodStart.getTime() + 60_000),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const estado = await estadoPro(token);

      expect(estado.used).toBe(1);
      expect(estado.remaining).toBe(estado.limit - 1);
    });

    it('la RESERVA atómica de cuota también sobrevive al Pro manual', async () => {
      // `hasAvailableFeaturedQuota` / `hasAvailableBumpQuota` tenían el mismo
      // `orderBy`, así que sin el arreglo el cliente de pago no podría gastar su
      // cuota aunque `pro-status` se la enseñara.
      const { user } = await crearUsuario('pago-reserva');
      await proDePago(user.id);
      await proSinPeriodo(user.id);

      const { EntitlementService } = await import(
        '../src/modules/billing/entitlement.service'
      );
      const service = app.get(EntitlementService);

      const [destacado, bump] = await prisma.$transaction(async (tx) => [
        await service.hasAvailableFeaturedQuota(tx, user.id),
        await service.hasAvailableBumpQuota(tx, user.id),
      ]);

      expect(destacado).toBe(true);
      expect(bump).toBe(true);
    });
  });

  // ── El Pro sin periodo ────────────────────────────────────────────────────

  describe('un Pro SÓLO manual: es Pro, pero sin cuota mensual (D-1)', () => {
    it('`isPro` es TRUE — antes se decía `false` porque no había periodo', async () => {
      const { user, token } = await crearUsuario('solo-manual');
      await proSinPeriodo(user.id);

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('NONE');
    });

    it('la cuota mensual NO APLICA, y se dice con ese nombre', async () => {
      const { user, token } = await crearUsuario('manual-sin-cuota');
      await proSinPeriodo(user.id);

      const estado = await estadoPro(token);

      expect(estado.quotaSource).toBe('NONE');
      expect(estado.limit).toBe(0);
      expect(estado.remaining).toBe(0);
      expect(estado.bumpQuota.limit).toBe(0);
      expect(estado.periodStart).toBeUndefined();
    });

    it('pero SÍ tiene las capacidades: los siete lectores del hecho lo ven Pro', async () => {
      // La otra mitad de D-1: se conceden las capacidades de Pro, no las
      // gratuidades mensuales. Se comprueba por el lector público, que es el
      // único observable sin montar media aplicación — los demás pasan por la
      // MISMA función (`isProActive`), así que uno basta para fijar el hecho.
      const { user } = await crearUsuario('manual-capacidades');
      await proSinPeriodo(user.id);

      const res = await request(server()).get(`/api/users/${user.slug}`);

      expect(res.status).toBe(200);
      expect(res.body.isPro).toBe(true);
    });

    it('un Pro manual CADUCADO deja de ser Pro (la caducidad se evalúa al leer)', async () => {
      const { user, token } = await crearUsuario('manual-caducado');
      await proSinPeriodo(user.id, new Date(Date.now() - 1000));

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(false);
      expect(estado.quotaSource).toBe('NONE');
    });

    it('un Pro manual REVOCADO deja de ser Pro', async () => {
      const { user, token } = await crearUsuario('manual-revocado');
      const ent = await proSinPeriodo(user.id);
      await prisma.entitlement.update({
        where: { id: ent.id },
        data: { revokedAt: new Date() },
      });

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(false);
    });
  });

  // ── El caso de pago puro ──────────────────────────────────────────────────

  describe('el pago puro no cambia (requisito de oro)', () => {
    it('un cliente de pago sin nada más ve exactamente lo de siempre', async () => {
      const { user, token } = await crearUsuario('pago-puro');
      const { periodStart, periodEnd } = await proDePago(user.id);

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('SUBSCRIPTION');
      expect(estado.remaining).toBe(estado.limit);
      expect(new Date(estado.periodStart!).getTime()).toBe(periodStart.getTime());
      expect(new Date((estado as { periodEnd?: string }).periodEnd!).getTime()).toBe(
        periodEnd.getTime(),
      );
    });

    it('un NO-Pro sigue viendo `isPro: false` y sin cuota', async () => {
      const { token } = await crearUsuario('no-pro');

      const estado = await estadoPro(token);

      expect(estado.isPro).toBe(false);
      expect(estado.quotaSource).toBe('NONE');
      expect(estado.limit).toBe(0);
    });
  });
});
