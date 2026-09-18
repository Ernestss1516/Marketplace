/**
 * CUOTAS PRO — PIEZA 1: EL PRO ANUAL RECIBE LA MISMA CUOTA MENSUAL QUE EL MENSUAL.
 *
 * ─── EL BUG QUE ESTA BATERÍA CIERRA ──────────────────────────────────────────────
 *
 * La cuota mensual se contaba con un `COUNT` desde `Subscription.currentPeriodStart`, es
 * decir, desde el ciclo de COBRO. Para un Pro mensual eso coincide con «al mes»; para un Pro
 * **ANUAL** el ciclo dura un año, así que su cuota «mensual» se contaba sobre 365 días:
 *
 *   · mensual (9,99 €/mes) → 4 destacados y 4 bumps al mes = **48 y 48 al año**
 *   · anual   (89,99 €/año) → 4 destacados y 4 bumps **AL AÑO** = 1/12
 *
 * Y no era sólo interno: `/planes` pinta en la tarjeta anual la MISMA lista de beneficios
 * que en la mensual —«4 destacados gratis al mes»— porque `proBenefits` se deriva de los
 * `Setting` y no mira el intervalo. La pantalla prometía doce veces lo que el motor daba.
 *
 * ─── LA MUTACIÓN QUE ESTOS CASOS DETECTAN ────────────────────────────────────────
 *
 * Volver a contar desde `currentPeriodStart` en cualquiera de las tres funciones de cuota.
 * El caso «gastó su cuota en meses anteriores del MISMO año de facturación» es el que la
 * caza: con la ventana en el mes natural ve la cuota entera; con la ventana en el ciclo de
 * cobro vería 0. Los demás casos pasarían igual con el bug puesto — éste no.
 *
 * Ver docs/auditoria-y-diseno-cuotas-pro.md §2 y §7, y `src/modules/billing/mes-natural.ts`.
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

describe('Cuotas Pro pieza 1 — paridad anual = mensual (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const categoria = await prisma.category.findFirst({ select: { id: true } });
    if (!categoria) throw new Error('No hay ninguna categoría sembrada — run seed-test.ts');
    categoryId = categoria.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function crearUsuario(sufijo: string) {
    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.create({
      data: {
        email: `paridad-${sufijo}@example.com`,
        name: `Paridad ${sufijo}`,
        slug: `paridad-${sufijo}`,
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

  async function precioPro(interval: 'MONTH' | 'YEAR') {
    const price = await prisma.price.findFirst({
      where: { interval, product: { type: ProductType.RECURRING } },
      select: { id: true },
    });
    if (!price) throw new Error(`No hay Price ${interval} sembrado (Plan Pro) — run seed-test.ts`);
    return price.id;
  }

  /**
   * Un Pro de pago con el ciclo REAL de su plan: un mes para el mensual, **un año para el
   * anual**. Esa diferencia es todo el experimento — es la que hacía que el anual recibiera
   * su cuota una vez al año.
   */
  async function proDePago(
    userId: string,
    interval: 'MONTH' | 'YEAR',
    inicioDelCiclo: Date = new Date(),
  ) {
    const priceId = await precioPro(interval);
    const finDelCiclo = new Date(inicioDelCiclo);
    if (interval === 'YEAR') finDelCiclo.setFullYear(finDelCiclo.getFullYear() + 1);
    else finDelCiclo.setMonth(finDelCiclo.getMonth() + 1);

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId,
        status: 'ACTIVE',
        currentPeriodStart: inicioDelCiclo,
        currentPeriodEnd: finDelCiclo,
        gatewaySubscriptionId: `sub_paridad_${interval}_${userId}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId,
        expiresAt: finDelCiclo,
      },
    });
    return { subscription, inicioDelCiclo, finDelCiclo };
  }

  async function anuncioActivo(userId: string, sufijo: string) {
    return prisma.listing.create({
      data: {
        title: `Paridad ${sufijo}`,
        slug: `paridad-${sufijo}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: ListingStatus.ACTIVE,
        sellerId: userId,
        categoryId,
      },
    });
  }

  /** Un destacado gastado de la cuota, fechado a voluntad. */
  async function gastarDestacado(userId: string, listingId: string, cuando: Date) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        origin: FeaturedOrigin.PRO_QUOTA,
        createdAt: cuando,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /** Un bump gastado de la cuota (amount 0 — es un marcador contable, no un movimiento). */
  async function gastarBump(userId: string, cuando: Date) {
    const wallet = await prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    return prisma.bumpLedger.create({
      data: {
        walletId: wallet.id,
        type: BumpLedgerType.PRO_QUOTA,
        amount: 0,
        createdAt: cuando,
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
    bumpQuota: { limit: number; used: number; remaining: number };
  }

  async function estadoPro(token: string): Promise<EstadoPro> {
    const res = await request(server())
      .get('/api/billing/pro-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as EstadoPro;
  }

  /** Un instante que cae, con seguridad, en un mes natural ANTERIOR al de hoy. */
  function haceUnosMeses(meses: number): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - meses);
    // Mediodía del día 15: lejos de cualquier borde de mes y de cualquier cambio de hora.
    d.setDate(15);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // ---------------------------------------------------------------------------
  // BARRERA 1 — el anual recibe la cuota ESTE MES, no 1/12
  // ---------------------------------------------------------------------------

  describe('BARRERA 1 — el Pro ANUAL recibe su cuota cada mes natural', () => {
    it('un anual recién dado de alta ve la cuota completa, igual que un mensual', async () => {
      const { user: anual, token: tokenAnual } = await crearUsuario('b1-anual');
      await proDePago(anual.id, 'YEAR');

      const estado = await estadoPro(tokenAnual);

      expect(estado.isPro).toBe(true);
      expect(estado.quotaSource).toBe('SUBSCRIPTION');
      expect(estado.limit).toBe(4);
      expect(estado.remaining).toBe(4);
      expect(estado.bumpQuota.limit).toBe(4);
      expect(estado.bumpQuota.remaining).toBe(4);
    });

    /**
     * EL CASO QUE MIDE EL BUG, Y EL QUE CAZA LA MUTACIÓN.
     *
     * Un anual que lleva 11 meses suscrito y gastó sus 4 destacados y sus 4 bumps en meses
     * anteriores. Su `currentPeriodStart` sigue siendo el de hace 11 meses, porque el ciclo
     * de cobro dura un año y todavía no ha renovado.
     *
     *   · CON EL BUG (contar desde `currentPeriodStart`): esos 8 gastos caen DENTRO de la
     *     ventana → used = 4 en cada cuota → **remaining 0 durante once meses más**.
     *   · ARREGLADO (contar desde el día 1): son del mes pasado → **remaining 4 y 4**.
     */
    it('un anual que gastó su cuota en meses ANTERIORES del mismo año de facturación la tiene entera hoy', async () => {
      const { user, token } = await crearUsuario('b1-gastado');
      const haceOnceMeses = haceUnosMeses(11);
      await proDePago(user.id, 'YEAR', haceOnceMeses);

      // Los 4 + 4 del bug: gastados hace meses, dentro del MISMO ciclo de cobro anual.
      for (let i = 0; i < 4; i++) {
        const anuncio = await anuncioActivo(user.id, `b1-viejo-${i}`);
        await gastarDestacado(user.id, anuncio.id, haceUnosMeses(3));
        await gastarBump(user.id, haceUnosMeses(3));
      }

      const estado = await estadoPro(token);

      // El COUNT los ve como lo que son: gasto de un mes natural ya cerrado.
      expect(estado.used).toBe(0);
      expect(estado.remaining).toBe(4);
      expect(estado.bumpQuota.used).toBe(0);
      expect(estado.bumpQuota.remaining).toBe(4);
    });

    it('y lo que gasta ESTE mes sí le descuenta — la cuota nueva no es infinita', async () => {
      const { user, token } = await crearUsuario('b1-esteMes');
      await proDePago(user.id, 'YEAR', haceUnosMeses(11));

      const anuncio = await anuncioActivo(user.id, 'b1-hoy');
      await gastarDestacado(user.id, anuncio.id, new Date());
      await gastarBump(user.id, new Date());

      const estado = await estadoPro(token);

      expect(estado.used).toBe(1);
      expect(estado.remaining).toBe(3);
      expect(estado.bumpQuota.used).toBe(1);
      expect(estado.bumpQuota.remaining).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // BARRERA 2 — el mensual no cambia
  // ---------------------------------------------------------------------------

  describe('BARRERA 2 — el Pro MENSUAL sigue recibiendo lo de siempre', () => {
    it('un mensual recién dado de alta ve la cuota completa', async () => {
      const { user, token } = await crearUsuario('b2-nuevo');
      await proDePago(user.id, 'MONTH');

      const estado = await estadoPro(token);

      expect(estado.limit).toBe(4);
      expect(estado.remaining).toBe(4);
      expect(estado.bumpQuota.remaining).toBe(4);
    });

    it('y lo gastado el mes pasado tampoco le cuenta (lo que ya hacía al renovar el ciclo)', async () => {
      const { user, token } = await crearUsuario('b2-mesPasado');
      await proDePago(user.id, 'MONTH');

      const anuncio = await anuncioActivo(user.id, 'b2-viejo');
      await gastarDestacado(user.id, anuncio.id, haceUnosMeses(1));
      await gastarBump(user.id, haceUnosMeses(1));

      const estado = await estadoPro(token);

      expect(estado.used).toBe(0);
      expect(estado.bumpQuota.used).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // LA PARIDAD — el requisito de oro, dicho como una sola comparación
  // ---------------------------------------------------------------------------

  describe('LA PARIDAD — misma cuota pague mensual o anual', () => {
    it('un anual y un mensual dados de alta el mismo día ven EXACTAMENTE lo mismo', async () => {
      const { user: mensual, token: tokenMensual } = await crearUsuario('par-mensual');
      const { user: anual, token: tokenAnual } = await crearUsuario('par-anual');
      await proDePago(mensual.id, 'MONTH');
      await proDePago(anual.id, 'YEAR');

      const estadoMensual = await estadoPro(tokenMensual);
      const estadoAnual = await estadoPro(tokenAnual);

      // Las cantidades: son las del PLAN PRO, no de la forma de pago.
      expect(estadoAnual.limit).toBe(estadoMensual.limit);
      expect(estadoAnual.remaining).toBe(estadoMensual.remaining);
      expect(estadoAnual.bumpQuota.limit).toBe(estadoMensual.bumpQuota.limit);
      expect(estadoAnual.bumpQuota.remaining).toBe(estadoMensual.bumpQuota.remaining);

      // Y la VENTANA: el mismo mes natural para los dos. Es la aserción que impide que
      // alguien «arregle» la paridad dándole al anual una ventana propia.
      expect(estadoAnual.periodStart).toBe(estadoMensual.periodStart);
      expect(estadoAnual.periodEnd).toBe(estadoMensual.periodEnd);
    });

    /**
     * LA PARIDAD SOBREVIVE AL DESALINEAMIENTO, que es donde el bug vivía: no basta con que
     * dos altas del mismo día coincidan (coincidirían incluso con el bug puesto, porque el
     * primer mes de un anual sí tiene su cuota). Aquí los dos ciclos de cobro empiezan en
     * meses distintos y hace mucho, y aun así la cuota de este mes es la misma.
     */
    it('y sobrevive a ciclos de cobro desalineados: mismo mes natural, misma cuota', async () => {
      const { user: mensual, token: tokenMensual } = await crearUsuario('par-desal-mensual');
      const { user: anual, token: tokenAnual } = await crearUsuario('par-desal-anual');
      // El ciclo del mensual empezó hace 20 días —a caballo entre dos meses naturales en
      // casi cualquier fecha— y sigue vivo. El del anual empezó hace ocho meses. Dos ciclos
      // que no se parecen en nada, y aun así la cuota de ESTE mes es la misma.
      const hace20Dias = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      await proDePago(mensual.id, 'MONTH', hace20Dias);
      await proDePago(anual.id, 'YEAR', haceUnosMeses(8));

      const estadoMensual = await estadoPro(tokenMensual);
      const estadoAnual = await estadoPro(tokenAnual);

      expect(estadoAnual.remaining).toBe(estadoMensual.remaining);
      expect(estadoAnual.bumpQuota.remaining).toBe(estadoMensual.bumpQuota.remaining);
      expect(estadoAnual.periodStart).toBe(estadoMensual.periodStart);
    });

    /**
     * BARRERA 6 (la mitad de servidor) — EL AVISO DE CADUCIDAD PUEDE LLEGAR AL ANUAL.
     *
     * `resolverAvisoCaducidad` (frontend) abre su ventana tres días antes de `periodEnd`.
     * Mientras ese campo fue `Subscription.currentPeriodEnd`, para un anual estaba a un año:
     * el aviso no se abría en 362 días. Lo que este caso fija es el dato del que depende —que
     * `periodEnd` está a menos de un mes— para que el aviso sea alcanzable todos los meses.
     * La lógica del aviso se prueba en `cuota-caducidad.test.ts` (B-4).
     */
    it('el periodEnd de un anual está a menos de un mes, no a un año (el aviso puede llegarle)', async () => {
      const { user, token } = await crearUsuario('aviso-anual');
      const { finDelCiclo } = await proDePago(user.id, 'YEAR');

      const estado = await estadoPro(token);
      const diasHastaElFinDeCuota =
        (new Date(estado.periodEnd!).getTime() - Date.now()) / 86_400_000;

      expect(diasHastaElFinDeCuota).toBeLessThan(32);

      // Y no es que la suscripción sea corta: su ciclo de COBRO sigue estando a un año.
      const diasHastaElCobro = (finDelCiclo.getTime() - Date.now()) / 86_400_000;
      expect(diasHastaElCobro).toBeGreaterThan(360);
    });
  });

  // ---------------------------------------------------------------------------
  // LA RESERVA — que el anual pueda GASTAR la cuota, no sólo verla
  // ---------------------------------------------------------------------------

  describe('LA RESERVA — el anual puede gastar de verdad lo que la pantalla le enseña', () => {
    /**
     * `getFeaturedQuotaStatus` (lo que se PINTA) y `hasAvailableFeaturedQuota` /
     * `hasAvailableBumpQuota` (lo que se RESERVA) son tres funciones distintas con la misma
     * aritmética. Arreglar sólo la primera daría el peor síntoma posible: la pantalla dice
     * «te quedan 4» y el botón responde «no tienes cuota». Este caso las ata.
     */
    it('destacar por cuota funciona para un anual con la cuota gastada en meses anteriores', async () => {
      const { user, token } = await crearUsuario('reserva-destacado');
      await proDePago(user.id, 'YEAR', haceUnosMeses(11));

      // El gasto viejo del mismo ciclo de cobro: con el bug, esto agotaba la cuota.
      for (let i = 0; i < 4; i++) {
        const viejo = await anuncioActivo(user.id, `reserva-viejo-${i}`);
        await gastarDestacado(user.id, viejo.id, haceUnosMeses(4));
      }

      const anuncio = await anuncioActivo(user.id, 'reserva-hoy');
      const res = await request(server())
        .post('/api/billing/featured-by-credits')
        .set('Authorization', `Bearer ${token}`)
        .send({ listingId: anuncio.id, useQuota: true })
        .expect(201);

      expect(res.body.viaQuota).toBe(true);

      // Y el destacado nuevo lleva el sello de la cuota, no el de los créditos.
      const concedido = await prisma.entitlement.findFirst({
        where: { listingId: anuncio.id, type: EntitlementType.FEATURED_LISTING },
        select: { origin: true },
      });
      expect(concedido?.origin).toBe(FeaturedOrigin.PRO_QUOTA);

      // Y queda reflejado: la reserva y la lectura cuentan lo mismo.
      const estado = await estadoPro(token);
      expect(estado.used).toBe(1);
      expect(estado.remaining).toBe(3);
    });

    it('y el bump por cuota también — la misma ventana en la tercera función', async () => {
      const { user, token } = await crearUsuario('reserva-bump');
      await proDePago(user.id, 'YEAR', haceUnosMeses(11));

      for (let i = 0; i < 4; i++) await gastarBump(user.id, haceUnosMeses(4));

      const anuncio = await anuncioActivo(user.id, 'reserva-bump-hoy');
      const res = await request(server())
        .post(`/api/listings/${anuncio.id}/bump`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.paidWith).toBe('PRO_QUOTA');

      const estado = await estadoPro(token);
      expect(estado.bumpQuota.used).toBe(1);
      expect(estado.bumpQuota.remaining).toBe(3);
    });
  });
});
