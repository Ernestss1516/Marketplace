/**
 * LOS GATES QUE NO EXPLICABAN — el lado del servidor.
 *
 * EL PATRÓN, uno con cinco instancias: un beneficio Pro que EXISTE pero no se cuenta en el
 * momento que importa, que es cuando un no-Pro descubre que le haría falta. Lo que este
 * fichero fija es lo que el backend tiene que servir para que la interfaz pueda contarlo:
 *
 *   · E-3 — el mensaje del cupo de anuncios ofrece la salida («con Pro puedes tener hasta
 *     N»), y SÓLO a quien no es Pro.
 *   · E-4/E-5 — el catálogo publica el regalo de cada pack YA CALCULADO, con la misma
 *     función que congela el checkout. Es lo que impide prometer un número y acreditar otro.
 *   · E-6 — el catálogo publica las cuotas mensuales en número, para que el aviso al no-Pro
 *     diga la cifra configurada y no una escrita a mano.
 *
 * Ver docs/auditoria-pro-video.md §4.2.
 */
import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { proBonusAmount } from 'src/modules/billing/pro-bonus';

const LIMITE_LIBRE = 'freeActiveListingLimit';
const LIMITE_PRO = 'proActiveListingLimit';
const TOCADOS = [LIMITE_LIBRE, LIMITE_PRO, 'proExtraCreditsPercent', 'proMonthlyFeaturedQuota', 'proMonthlyBumpQuota'];

describe('Los gates Pro explican el beneficio (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let originales: Record<string, unknown> = {};

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const previos = await prisma.setting.findMany({ where: { key: { in: TOCADOS } } });
    originales = Object.fromEntries(previos.map((s) => [s.key, s.value]));
  });

  afterAll(async () => {
    // `Setting` es dato de sistema compartido entre suites y `cleanDb` no lo limpia.
    for (const [key, value] of Object.entries(originales)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  function fijar(key: string, value: number) {
    return prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async function crearUsuario(sufijo: string, pro: boolean) {
    const user = await prisma.user.create({
      data: {
        email: `gate-${sufijo}@example.com`,
        name: `Gate ${sufijo}`,
        slug: `gate-${sufijo}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
      select: { id: true },
    });
    if (pro) {
      await prisma.entitlement.create({
        data: {
          userId: user.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `gate-${sufijo}@example.com`, password: 'Test1234!' });
    return { id: user.id, token: login.body.accessToken as string };
  }

  /** Deja al vendedor con `cuantos` anuncios ACTIVE y un borrador listo para publicar. */
  async function llenarCupo(sellerId: string, sufijo: string, cuantos: number) {
    for (let i = 0; i < cuantos; i++) {
      await prisma.listing.create({
        data: {
          title: `Activo ${sufijo} ${i}`,
          slug: `gate-${sufijo}-activo-${i}`,
          description: 'x',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId,
          categoryId,
          publishedAt: new Date(),
        },
      });
    }
    const borrador = await prisma.listing.create({
      data: {
        title: `Borrador ${sufijo}`,
        slug: `gate-${sufijo}-borrador`,
        description: 'x',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.DRAFT,
        sellerId,
        categoryId,
      },
      select: { id: true },
    });
    return borrador.id;
  }

  // ── E-3 — el cupo de anuncios ofrece la salida ─────────────────────────────

  describe('E-3 — el límite de anuncios activos', () => {
    it('a un NO-Pro le dice que Pro sube el límite, y con qué número', async () => {
      await fijar(LIMITE_LIBRE, 2);
      await fijar(LIMITE_PRO, 20);
      const { id, token } = await crearUsuario('limite-libre', false);
      const borrador = await llenarCupo(id, 'libre', 2);

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${borrador}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      // El mensaje ya no se queda en «de tu plan»: dice qué plan y cuánto da.
      expect(res.body.message).toContain('2');
      expect(res.body.message).toMatch(/con pro puedes tener hasta 20/i);
      // Y el CÓDIGO viaja, que es de lo que la interfaz cuelga el enlace a /planes.
      expect(res.body.code).toBe('ACTIVE_LIMIT_REACHED');
    });

    it('a un PRO que agota SU cupo no se le vende Pro otra vez', async () => {
      await fijar(LIMITE_LIBRE, 2);
      await fijar(LIMITE_PRO, 3);
      const { id, token } = await crearUsuario('limite-pro', true);
      const borrador = await llenarCupo(id, 'pro', 3);

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${borrador}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.message).toContain('3');
      // Ya es Pro: ofrecerle Pro no es una salida, es ruido.
      expect(res.body.message).not.toMatch(/con pro/i);
    });

    it('y si Pro NO diera más, tampoco se promete: lo que el ajuste no concede, no se anuncia', async () => {
      // Los dos límites son ajustes de admin y pueden cruzarse. Mismo criterio que la lista
      // de beneficios de /planes, que compara antes de prometer.
      await fijar(LIMITE_LIBRE, 5);
      await fijar(LIMITE_PRO, 5);
      const { id, token } = await crearUsuario('limite-igual', false);
      const borrador = await llenarCupo(id, 'igual', 5);

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${borrador}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.message).not.toMatch(/con pro/i);
    });
  });

  // ── E-4/E-5 — el regalo de cada pack, previsualizable ──────────────────────

  describe('E-4/E-5 — el catálogo publica el bonus de cada pack', () => {
    async function catalogo() {
      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      return res.body as {
        proExtraCreditsPercent?: number;
        proExtraBumpsPercent: number;
        products: {
          prices: {
            creditAmount?: number;
            bumpAmount?: number;
            proBonusAmount?: number;
          }[];
        }[];
      };
    }

    it('los packs de CRÉDITOS lo traen — antes no lo veía nadie, ni siquiera un Pro', async () => {
      const cat = await catalogo();
      const packs = cat.products.flatMap((p) => p.prices).filter((p) => p.creditAmount != null);

      expect(packs.length).toBeGreaterThan(0);
      for (const pack of packs) {
        expect(pack.proBonusAmount).toBe(
          proBonusAmount(pack.creditAmount!, cat.proExtraCreditsPercent!),
        );
      }
    });

    it('los packs de BUMPS también, con SU ajuste (nunca el de créditos)', async () => {
      const cat = await catalogo();
      const packs = cat.products.flatMap((p) => p.prices).filter((p) => p.bumpAmount != null);

      expect(packs.length).toBeGreaterThan(0);
      for (const pack of packs) {
        expect(pack.proBonusAmount).toBe(
          proBonusAmount(pack.bumpAmount!, cat.proExtraBumpsPercent),
        );
      }
    });

    it('REQUISITO DE ORO — lo que se previsualiza es lo que el checkout congela', async () => {
      // La prueba de que no hay dos fórmulas. Se compra de verdad un pack siendo Pro y se
      // compara el `bonusCreditAmount` congelado en la Transaction con el `proBonusAmount`
      // que el catálogo enseñaba.
      //
      // EL PORCENTAJE SE FUERZA A UNO QUE NO DIVIDE EXACTO, y no es un detalle: con el 20 %
      // sembrado, los importes de los packs dan enteros, así que `Math.ceil` y `Math.floor`
      // coinciden y una fórmula duplicada con el redondeo cambiado pasaría desapercibida.
      // (Comprobado: la mutación no moría hasta forzar esto.) El redondeo HACIA ARRIBA es
      // parte del beneficio —va a favor del usuario—, así que tiene que estar cubierto.
      await fijar('proExtraCreditsPercent', 15);
      try {
        const { token } = await crearUsuario('bonus-pro', true);
        const cat = await catalogo();
        const pack = await prisma.creditPack.findFirstOrThrow({
          where: { active: true },
          select: { id: true, creditAmount: true },
        });
        const anunciado = cat.products
          .flatMap((p) => p.prices)
          .find((p) => p.creditAmount === pack.creditAmount)!.proBonusAmount;

        // El fixture tiene que ejercitar el redondeo, o este test no mide lo que dice.
        expect((pack.creditAmount * 15) % 100).not.toBe(0);

        await request(app.getHttpServer())
          .post('/api/billing/checkout/credits-pack')
          .set('Authorization', `Bearer ${token}`)
          .send({ packId: pack.id })
          .expect(201);

        const tx = await prisma.transaction.findFirstOrThrow({
          where: { baseCreditAmount: pack.creditAmount, bonusCreditAmount: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { bonusCreditAmount: true },
        });

        expect(tx.bonusCreditAmount).toBe(anunciado);
        expect(tx.bonusCreditAmount).toBe(Math.ceil((pack.creditAmount * 15) / 100));
      } finally {
        await fijar('proExtraCreditsPercent', 20);
      }
    });
  });

  // ── E-6 — las cuotas mensuales, en número ──────────────────────────────────

  it('E-6 — el catálogo publica las cuotas mensuales, para poder decir la cifra real', async () => {
    // Estaban sólo dentro de las frases de `proBenefits`, así que ninguna otra pantalla
    // podía nombrarlas sin volver a inventarse el número.
    await fijar('proMonthlyFeaturedQuota', 7);
    await fijar('proMonthlyBumpQuota', 3);

    const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);

    expect(res.body.proMonthlyFeaturedQuota).toBe(7);
    expect(res.body.proMonthlyBumpQuota).toBe(3);

    await fijar('proMonthlyFeaturedQuota', 4);
    await fijar('proMonthlyBumpQuota', 4);
  });
});
