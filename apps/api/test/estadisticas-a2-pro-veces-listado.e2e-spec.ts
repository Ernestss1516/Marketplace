/**
 * ESTADÍSTICAS A2 — el vendedor Pro lee lo que A1 captura.
 *
 * Primera lectora de la telemetría de impresiones. Lo que se fija aquí:
 *  · el endpoint sirve el total y la SERIE DIARIA de «veces listado» (la segunda línea);
 *  · el CTR sale de las series y no de los totales, y calla cuando la muestra es pequeña;
 *  · el gate Pro NO se ha movido: la respuesta del no-Pro es exactamente la de siempre.
 *
 * La captura (que las impresiones lleguen a la tabla) es de A1 y tiene su propia batería:
 * aquí las filas se siembran a mano, porque lo que se prueba es la LECTURA.
 *
 * Diseño: docs/diseno-estadisticas.md §2.7.
 */
import { INestApplication } from '@nestjs/common';
import { EntitlementType, Prisma, PrismaClient, ProductType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { CTR_MIN_IMPRESSIONS } from 'src/modules/listings/listing-ctr';

describe('Estadísticas A2 — el Pro ve las «veces listado» (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers (molde de h8-c1-listing-stats.e2e-spec.ts)
  // ---------------------------------------------------------------------------

  let seq = 0;

  async function crearUsuario(sufijo: string) {
    seq += 1;
    const email = `a2-${sufijo}-${seq}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `A2 ${sufijo}`,
        slug: `a2-${sufijo}-${seq}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return { user, token: login.body.accessToken as string };
  }

  async function hacerPro(userId: string) {
    const price = await prisma.price.findFirstOrThrow({
      where: { product: { type: ProductType.RECURRING } },
    });
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        priceId: price.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
        gatewaySubscriptionId: `sub_a2_${userId}`,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: subscription.id,
        priceId: price.id,
        expiresAt: subscription.currentPeriodEnd,
      },
    });
  }

  async function crearAnuncio(sellerId: string, sufijo: string) {
    seq += 1;
    return prisma.listing.create({
      data: {
        title: `A2 anuncio ${sufijo}`,
        slug: `a2-anuncio-${sufijo}-${seq}`,
        description: 'desc',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  /** Un día concreto, en UTC — el mismo troceo con el que escriben A1 y `trackView`. */
  function haceDias(dias: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - dias);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /** Siembra telemetría: las filas diarias Y el total, como los dejaría la captura real. */
  async function sembrar(
    listingId: string,
    vistas: Array<[number, number]>,
    impresiones: Array<[number, number]>,
  ) {
    if (vistas.length) {
      await prisma.listingViewDaily.createMany({
        data: vistas.map(([dias, count]) => ({ listingId, date: haceDias(dias), count })),
      });
    }
    if (impresiones.length) {
      await prisma.listingImpressionDaily.createMany({
        data: impresiones.map(([dias, count]) => ({ listingId, date: haceDias(dias), count })),
      });
    }
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        viewCount: vistas.reduce((s, [, c]) => s + c, 0),
        impressionCount: impresiones.reduce((s, [, c]) => s + c, 0),
      },
    });
  }

  function pedirStats(listingId: string, token: string) {
    return request(app.getHttpServer())
      .get(`/api/listings/mine/${listingId}/stats`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — la segunda línea
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — el endpoint sirve las «veces listado»', () => {
    it('el Pro recibe el total y la serie diaria, junto a las que ya tenía', async () => {
      const { user, token } = await crearUsuario('serie');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'serie');
      await sembrar(anuncio.id, [[2, 3], [1, 4]], [[2, 60], [1, 90]]);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.impressionCount).toBe(150);
      expect(res.body.dailyImpressions).toHaveLength(2);
      expect(res.body.dailyImpressions.map((f: { count: number }) => f.count)).toEqual([60, 90]);
      // Y lo de siempre sigue estando: A2 es aditivo, no un rediseño de la respuesta.
      expect(res.body.viewCount).toBe(7);
      expect(res.body.dailyViews).toHaveLength(2);
      expect(res.body.likeRatio).toBeDefined();
    });

    it('la serie de impresiones viene ordenada por fecha ascendente, como la de vistas', async () => {
      const { user, token } = await crearUsuario('orden');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'orden');
      await sembrar(anuncio.id, [], [[1, 10], [5, 20], [3, 30]]);

      const res = await pedirStats(anuncio.id, token);
      const fechas = res.body.dailyImpressions.map((f: { date: string }) => f.date);

      expect([...fechas].sort()).toEqual(fechas);
    });

    it('un anuncio sin impresiones devuelve la serie vacía, no `undefined`', async () => {
      // La gráfica tiene que poder pintar una línea plana y decir «aún no hay datos»,
      // no romperse por un campo ausente.
      const { user, token } = await crearUsuario('vacio');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'vacio');

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.dailyImpressions).toEqual([]);
      expect(res.body.impressionCount).toBe(0);
    });

    it('solo entran los últimos 30 días, el mismo rango que las vistas', async () => {
      const { user, token } = await crearUsuario('rango');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'rango');
      await sembrar(anuncio.id, [], [[40, 500], [2, 10]]);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.dailyImpressions).toHaveLength(1);
      expect(res.body.dailyImpressions[0].count).toBe(10);
      // El TOTAL sí incluye lo viejo: es el número redondo del anuncio, no el de la ventana.
      expect(res.body.impressionCount).toBe(510);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — el CTR y la muestra pequeña
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 2 — el CTR no engaña con pocas apariciones', () => {
    it('LA MUTACIÓN: 2 visitas sobre 3 apariciones NO devuelve un 67%', async () => {
      const { user, token } = await crearUsuario('ruido');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'ruido');
      await sembrar(anuncio.id, [[1, 2]], [[1, 3]]);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.ctr.value).toBeNull();
      // Los conteos viajan igual: la interfaz dice «llevas 3 de 100», no se calla del todo.
      expect(res.body.ctr.impressions).toBe(3);
      expect(res.body.ctr.views).toBe(2);
      expect(res.body.ctr.minImpressions).toBe(CTR_MIN_IMPRESSIONS);
    });

    it('con apariciones suficientes sí se calcula', async () => {
      const { user, token } = await crearUsuario('suficiente');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'suficiente');
      await sembrar(anuncio.id, [[1, 10]], [[1, 200]]);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.ctr.value).toBeCloseTo(0.05);
    });

    it('LA OTRA MUTACIÓN: el CTR no sale de dividir los dos TOTALES', async () => {
      // El estado de todo el catálogo el día que se desplegó A1: un año de visitas y un
      // día de apariciones. `viewCount / impressionCount` daría 2000/150 = 1.333%.
      // La ventana comparable empieza donde empiezan las apariciones.
      const { user, token } = await crearUsuario('ventana');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'ventana');
      await sembrar(anuncio.id, [[20, 2000], [1, 15]], [[1, 150]]);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.viewCount).toBe(2015); // el total histórico no cambia
      expect(res.body.ctr.views).toBe(15); // pero el CTR solo mira la ventana comparable
      expect(res.body.ctr.value).toBeCloseTo(15 / 150);
    });

    it('sin ninguna aparición el CTR es `null`, no una división por cero', async () => {
      const { user, token } = await crearUsuario('sinimp');
      await hacerPro(user.id);
      const anuncio = await crearAnuncio(user.id, 'sinimp');
      await sembrar(anuncio.id, [[1, 5]], []);

      const res = await pedirStats(anuncio.id, token);

      expect(res.body.ctr.value).toBeNull();
      expect(res.body.ctr.impressions).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — el gate Pro, intacto
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 3 — el no-Pro no ve nada de esto', () => {
    it('la respuesta del no-Pro es EXACTAMENTE la de siempre, campo por campo', async () => {
      const { user, token } = await crearUsuario('nopro');
      const anuncio = await crearAnuncio(user.id, 'nopro');
      // Aunque el anuncio TENGA impresiones capturadas, no asoman.
      await sembrar(anuncio.id, [[1, 5]], [[1, 400]]);

      const res = await pedirStats(anuncio.id, token);

      // `toEqual` sobre el objeto entero y no una lista de `not.toBeDefined()`: así, el
      // día que alguien añada un campo Pro sin mirar el gate, este test cae.
      expect(res.body).toEqual({ viewCount: 5, favoritesCount: 0 });
    });

    it('el dueño sigue siendo el único que puede pedirlas', async () => {
      const { user } = await crearUsuario('duenyo');
      const { token: ajeno } = await crearUsuario('ajeno');
      const anuncio = await crearAnuncio(user.id, 'duenyo');

      await request(app.getHttpServer())
        .get(`/api/listings/mine/${anuncio.id}/stats`)
        .set('Authorization', `Bearer ${ajeno}`)
        .expect(403);
    });
  });
});
