/**
 * ESTADÍSTICAS B1 — el staff lee la telemetría que A capturó.
 *
 * Lo que se fija aquí:
 *  · el PISO: MODERATOR y ADMIN entran; EDITOR y USER no, y sin sesión tampoco. Que la
 *    telemetría NO baje al piso del dashboard (que es EDITOR) es una decisión del diseño,
 *    no un descuido, y esta matriz es lo que impide que se relaje sin querer;
 *  · la actividad de un ANUNCIO: las dos series, los totales y los dos ratios, sin gate
 *    Pro — el staff lo ve sobre anuncios de vendedores que no pagan nada;
 *  · la actividad de un USUARIO: la suma de TODOS sus anuncios, incluidos los que no
 *    están ACTIVE, con su anuncio más visto y el más listado.
 *
 * Las filas diarias se siembran a mano: la CAPTURA es de A1 y tiene su propia batería.
 * Aquí se prueba la LECTURA.
 *
 * Diseño: docs/diseno-estadisticas.md, parte B (B.1 y B.2).
 */
import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { CTR_MIN_IMPRESSIONS } from 'src/modules/listings/listing-ctr';

describe('Estadísticas B1 — el backoffice lee la actividad (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  let moderatorToken: string;
  let adminToken: string;
  let editorToken: string;
  let userToken: string;

  let vendedorId: string;
  let anuncioA: string;
  let anuncioArchivado: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;

    const hash = await bcrypt.hash('Test1234!', 4);
    const crear = (sufijo: string, role: 'USER' | 'EDITOR' | 'MODERATOR' | 'ADMIN') =>
      prisma.user.create({
        data: {
          email: `b1-${sufijo}@example.com`,
          name: `B1 ${sufijo}`,
          slug: `b1-${sufijo}`,
          passwordHash: hash,
          emailVerified: true,
          role,
        },
      });

    const [moderator, admin, editor, usuario, vendedor] = await Promise.all([
      crear('moderator', 'MODERATOR'),
      crear('admin', 'ADMIN'),
      crear('editor', 'EDITOR'),
      crear('user', 'USER'),
      crear('vendedor', 'USER'),
    ]);
    vendedorId = vendedor.id;

    const [mod, adm, edi, usu] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: moderator.email, password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: admin.email, password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: editor.email, password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: usuario.email, password: 'Test1234!' }),
    ]);
    moderatorToken = mod.body.accessToken;
    adminToken = adm.body.accessToken;
    editorToken = edi.body.accessToken;
    userToken = usu.body.accessToken;

    // El vendedor NO es Pro a propósito: el staff ve su actividad igual. Es la mitad
    // «sin gate Pro» de la barrera del anuncio.
    anuncioA = await crearAnuncio('activo', ListingStatus.ACTIVE);
    anuncioArchivado = await crearAnuncio('archivado', ListingStatus.ARCHIVED);

    // Ayer y anteayer, para que la serie tenga dos puntos y la ventana de 7 los coja.
    await sembrar(anuncioA, [[2, 4], [1, 6]], [[2, 120], [1, 80]]);
    // El archivado APORTA a los totales del usuario: su actividad pasada es justo lo que
    // el staff quiere ver. Sus impresiones son viejas (fuera de la ventana de 7 días).
    await sembrar(anuncioArchivado, [[40, 500], [1, 10]], [[40, 900]]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  let seq = 0;

  async function crearAnuncio(sufijo: string, status: ListingStatus): Promise<string> {
    seq += 1;
    const creado = await prisma.listing.create({
      data: {
        title: `B1 anuncio ${sufijo}`,
        slug: `b1-anuncio-${sufijo}-${seq}`,
        description: 'desc',
        price: new Prisma.Decimal('50.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId: vendedorId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    return creado.id;
  }

  function haceDias(dias: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - dias);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

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

  const pedir = (ruta: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/admin/stats/${ruta}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — el piso de rol
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — MODERATOR y ADMIN sí; EDITOR, USER y anónimo no', () => {
    it('MODERATOR entra', async () => {
      await pedir(`listings/${anuncioA}`, moderatorToken).expect(200);
      await pedir(`users/${vendedorId}`, moderatorToken).expect(200);
    });

    it('ADMIN entra (la escalera: quien puede más, puede lo de abajo)', async () => {
      await pedir(`listings/${anuncioA}`, adminToken).expect(200);
      await pedir(`users/${vendedorId}`, adminToken).expect(200);
    });

    it('EDITOR NO entra, aunque SÍ pueda ver el dashboard', async () => {
      // La distinción que sostiene la decisión de no ampliar `GET /admin/stats`: el
      // dashboard es EDITOR y la telemetría es MODERATOR. Si algún día alguien mueve
      // este piso «por comodidad», esto cae.
      await pedir(`listings/${anuncioA}`, editorToken).expect(403);
      await pedir(`users/${vendedorId}`, editorToken).expect(403);
    });

    it('un USER corriente NO entra', async () => {
      await pedir(`listings/${anuncioA}`, userToken).expect(403);
      await pedir(`users/${vendedorId}`, userToken).expect(403);
    });

    it('sin sesión → 401, no 403', async () => {
      await pedir(`listings/${anuncioA}`).expect(401);
      await pedir(`users/${vendedorId}`).expect(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — la actividad de un anuncio
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 2 — la actividad de un anuncio', () => {
    it('sirve las DOS series, los totales y los dos ratios', async () => {
      const res = await pedir(`listings/${anuncioA}`, moderatorToken).expect(200);

      expect(res.body.dailyViews.map((f: { count: number }) => f.count)).toEqual([4, 6]);
      expect(res.body.dailyImpressions.map((f: { count: number }) => f.count)).toEqual([120, 80]);
      expect(res.body.viewCount).toBe(10);
      expect(res.body.impressionCount).toBe(200);
      expect(res.body.ctr).toBeDefined();
      expect(res.body.likeRatio).toBeDefined();
    });

    it('SIN gate Pro: el vendedor no paga nada y el staff lo ve igual', async () => {
      // La diferencia con `/listings/mine/:id/stats`, que sí recorta por plan. Aquí lo
      // que decide es el rol, y ya se ha comprobado arriba.
      const pro = await prisma.entitlement.findFirst({
        where: { userId: vendedorId, type: 'PRO_SUBSCRIPTION' },
      });
      expect(pro).toBeNull(); // el vendedor de esta suite es free

      const res = await pedir(`listings/${anuncioA}`, moderatorToken).expect(200);
      expect(res.body.dailyImpressions.length).toBeGreaterThan(0);
    });

    it('los ratios llevan el MISMO tratamiento de muestra pequeña que ve el vendedor', async () => {
      const res = await pedir(`listings/${anuncioA}`, moderatorToken).expect(200);

      // 200 apariciones ≥ el umbral → hay CTR; 10 visitas < 30 → no hay ratio de me gusta.
      expect(res.body.ctr.value).toBeCloseTo(10 / 200);
      expect(res.body.ctr.minImpressions).toBe(CTR_MIN_IMPRESSIONS);
      expect(res.body.likeRatio.value).toBeNull();
      expect(res.body.likeRatio.views).toBe(10);
    });

    it('la ventana acota la serie, y sólo admite 7/30/90', async () => {
      const siete = await pedir(`listings/${anuncioArchivado}?days=7`, moderatorToken).expect(200);
      expect(siete.body.days).toBe(7);
      expect(siete.body.dailyViews).toHaveLength(1); // la de hace 40 días queda fuera

      const noventa = await pedir(`listings/${anuncioArchivado}?days=90`, moderatorToken).expect(200);
      expect(noventa.body.dailyViews).toHaveLength(2);

      // Un rango libre convertiría un endpoint de lectura en «pídeme 3.650 días».
      await pedir(`listings/${anuncioA}?days=3650`, moderatorToken).expect(400);
      await pedir(`listings/${anuncioA}?days=45`, moderatorToken).expect(400);
    });

    it('sin `days` la ventana por defecto es 30, la misma que ve el vendedor Pro', async () => {
      const res = await pedir(`listings/${anuncioA}`, moderatorToken).expect(200);
      expect(res.body.days).toBe(30);
    });

    it('un anuncio que no existe → 404', async () => {
      await pedir('listings/no-existe-b1', moderatorToken).expect(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — la actividad de un usuario
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 3 — el conjunto de anuncios de un usuario', () => {
    it('SUMA los anuncios del vendedor, día a día', async () => {
      const res = await pedir(`users/${vendedorId}?days=90`, moderatorToken).expect(200);

      // Ayer: 6 (activo) + 10 (archivado) = 16. Anteayer: 4. Hace 40 días: 500.
      const porFecha = Object.fromEntries(
        res.body.dailyViews.map((f: { date: string; count: number }) => [f.date.slice(0, 10), f.count]),
      );
      const dia = (n: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - n);
        return d.toISOString().slice(0, 10);
      };
      expect(porFecha[dia(1)]).toBe(16);
      expect(porFecha[dia(2)]).toBe(4);
      expect(porFecha[dia(40)]).toBe(500);
    });

    it('cuenta TODOS sus anuncios, también los que no están ACTIVE', async () => {
      // Un archivado que acumuló medio millar de visitas es exactamente lo que el staff
      // busca al preguntarse «¿qué actividad genera esta persona?».
      const res = await pedir(`users/${vendedorId}`, moderatorToken).expect(200);

      expect(res.body.listingCount).toBe(2);
      expect(res.body.viewCount).toBe(10 + 510);
      expect(res.body.impressionCount).toBe(200 + 900);
    });

    it('señala su anuncio más visto y el más listado, con id para enlazar', async () => {
      const res = await pedir(`users/${vendedorId}`, moderatorToken).expect(200);

      expect(res.body.mostViewed.id).toBe(anuncioArchivado); // 510 > 10
      expect(res.body.mostListed.id).toBe(anuncioArchivado); // 900 > 200
      expect(res.body.mostViewed.title).toContain('archivado');
    });

    it('la ventana acota la serie agregada igual que la de un anuncio', async () => {
      const siete = await pedir(`users/${vendedorId}?days=7`, moderatorToken).expect(200);
      const noventa = await pedir(`users/${vendedorId}?days=90`, moderatorToken).expect(200);

      expect(siete.body.dailyViews.length).toBeLessThan(noventa.body.dailyViews.length);
      // Los TOTALES no dependen de la ventana: son el número redondo del vendedor.
      expect(siete.body.viewCount).toBe(noventa.body.viewCount);
    });

    it('un usuario sin anuncios devuelve ceros y series vacías, no un error', async () => {
      const solo = await prisma.user.create({
        data: {
          email: 'b1-sin-anuncios@example.com',
          name: 'Sin anuncios',
          slug: 'b1-sin-anuncios',
          passwordHash: 'x',
          emailVerified: true,
        },
        select: { id: true },
      });

      const res = await pedir(`users/${solo.id}`, moderatorToken).expect(200);

      expect(res.body.listingCount).toBe(0);
      expect(res.body.viewCount).toBe(0);
      expect(res.body.dailyViews).toEqual([]);
      expect(res.body.mostViewed).toBeNull();
      expect(res.body.ctr.value).toBeNull();
    });

    it('un usuario que no existe → 404', async () => {
      await pedir('users/no-existe-b1', moderatorToken).expect(404);
    });
  });
});
