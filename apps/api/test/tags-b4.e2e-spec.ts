/**
 * BÚSQUEDA+TAGS — RÁFAGA B4: sugerencias del buscador de portada.
 *
 * La pieza que cierra el trabajo. Lo que se ejerce, y sobre todo POR QUÉ la
 * implementación es Postgres-first en vez de una búsqueda de facetas a secas:
 *
 *  · un tag SIN anuncios se sugiere igual, al final y con (0) — P6. Una búsqueda de
 *    facetas no puede devolverlo por definición, así que este test ES la justificación
 *    de la decisión, no un extra;
 *  · el orden lo manda el conteo, y a igualdad el criterio editorial (`orden`), que una
 *    faceta tampoco conoce.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient } from './helpers/db';
import { waitForIndex } from './helpers/meili';
import { withSetting } from './helpers/settings';

const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

interface Sugerencia { id: string; slug: string; name: string; count: number }

describe('Sugerencias de etiquetas (B4, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let token: string;
  let adminToken: string;
  let sellerId: string;
  let adminId: string;

  let padreId: string;
  let hijaId: string;
  let hijaSlug: string;
  let otraId: string;
  let otraSlug: string;

  const stamp = Date.now();
  // Nombres pensados para el emparejamiento por NOMBRE: los tres primeros comparten
  // "diesel"/"Diés" para probar el ILIKE, y `sinAnuncios` es el del caso P6.
  const S = {
    diesel: `b4-diesel-${stamp}`,
    dieselPremium: `b4-diesel-premium-${stamp}`,
    sinAnuncios: `b4-diesel-sin-uso-${stamp}`,
    deOtra: `b4-de-otra-${stamp}`,
  };
  const NOMBRES: Record<keyof typeof S, string> = {
    diesel: 'Diesel',
    dieselPremium: 'Diesel Premium',
    sinAnuncios: 'Diesel Sin Uso',
    deOtra: 'Solo En Otra',
  };
  const tagIds: Record<string, string> = {};

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function asignarTags(categoryId: string, ids: string[]) {
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${categoryId}/tags`).set(adminAuth())
      .send({ tagIds: ids }).expect(200);
  }

  async function publicar(titulo: string, tags: string[], categoryId = hijaId) {
    const res = await request(app.getHttpServer())
      .post('/api/listings').set(auth())
      .send({
        title: titulo,
        description: `Descripción de prueba para "${titulo}", suficientemente larga.`,
        price: 1000, type: 'PRODUCT', condition: 'GOOD', priceType: 'FIXED',
        categoryId, city: 'Madrid', province: 'Madrid',
        latitude: 40.4168, longitude: -3.7038,
        tags,
      }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);
    return res.body.id as string;
  }

  async function sugerir(qs: string): Promise<Sugerencia[]> {
    const res = await request(app.getHttpServer()).get(`/api/tags/suggest?${qs}`).expect(200);
    return res.body as Sugerencia[];
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    const padre = await prisma.category.create({
      data: { name: 'B4 Padre', slug: `b4-padre-${stamp}`, order: 970, attributeSchema: [] },
    });
    padreId = padre.id;
    hijaSlug = `b4-hija-${stamp}`;
    const hija = await prisma.category.create({
      data: { name: 'B4 Hija', slug: hijaSlug, parentId: padre.id, order: 971, attributeSchema: [] },
    });
    hijaId = hija.id;
    otraSlug = `b4-otra-${stamp}`;
    const otra = await prisma.category.create({
      data: { name: 'B4 Otra', slug: otraSlug, order: 972, attributeSchema: [] },
    });
    otraId = otra.id;

    // `orden` a la INVERSA de lo que será su popularidad, para que el test de orden
    // distinga "ordenado por conteo" de "ordenado por criterio editorial".
    let orden = 0;
    for (const clave of Object.keys(S) as (keyof typeof S)[]) {
      const tag = await prisma.tag.create({
        data: { slug: S[clave], name: NOMBRES[clave], orden: orden++ },
      });
      tagIds[clave] = tag.id;
    }

    const email = `b4-seller-${stamp}@example.com`;
    const user = await prisma.user.create({
      data: {
        email, name: 'B4 Seller', slug: `b4-seller-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
    });
    sellerId = user.id;
    token = (await request(app.getHttpServer())
      .post('/api/auth/login').send({ email, password: 'Test1234!' })).body.accessToken;

    const adminEmail = `b4-admin-${stamp}@example.com`;
    const admin = await prisma.user.create({
      data: {
        email: adminEmail, name: 'B4 Admin', slug: `b4-admin-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
    });
    adminId = admin.id;
    adminToken = (await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: adminEmail, password: 'Test1234!' })).body.accessToken;

    await asignarTags(hijaId, [tagIds.diesel, tagIds.dieselPremium, tagIds.sinAnuncios]);
    await asignarTags(otraId, [tagIds.deOtra]);

    // El tope subido SÓLO mientras se publica, y restaurado a la fila exacta — no
    // borrado, que es lo que hacía el `afterAll` de antes. Ver la nota larga en
    // `tags-b3.e2e-spec.ts` y `helpers/settings.ts`.
    await withSetting(prisma, 'freeActiveListingLimit', 500, async () => {
      // `diesel` en 2 anuncios, `dieselPremium` en 1, `sinAnuncios` en NINGUNO.
      await publicar('B4 Coche diesel uno', [S.diesel]);
      await publicar('B4 Coche diesel dos', [S.diesel, S.dieselPremium]);
    });
  }, 120_000);

  // Sin afterEach de limpieza a propósito: tocar el catálogo por la VÍA REAL (los
  // endpoints admin) ya invalida la caché de sugerencias, así que los tests que
  // reordenan o reasignan ven el estado nuevo solos. El único que escribe en la tabla
  // por debajo es el de la caché, y lo hace precisamente para comprobar que NO se
  // invalida.

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [sellerId, adminId] } } });
    await prisma.categoryTag.deleteMany({ where: { categoryId: { in: [padreId, hijaId, otraId] } } });
    await prisma.tag.deleteMany({ where: { id: { in: Object.values(tagIds) } } });
    await prisma.category.deleteMany({ where: { id: { in: [hijaId, otraId, padreId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ── Emparejamiento por nombre ────────────────────────────────────────────────

  it('sugiere las etiquetas cuyo NOMBRE casa con el texto', async () => {
    const s = await sugerir(`q=diesel&category=${hijaSlug}`);
    const slugs = s.map((x) => x.slug);
    expect(slugs).toContain(S.diesel);
    expect(slugs).toContain(S.dieselPremium);
  });

  it('un texto que no casa con nada devuelve lista vacía, no un error', async () => {
    expect(await sugerir(`q=zzzznadaquecase&category=${hijaSlug}`)).toEqual([]);
  });

  it('el emparejamiento ignora mayúsculas', async () => {
    const s = await sugerir(`q=DIESEL&category=${hijaSlug}`);
    expect(s.map((x) => x.slug)).toContain(S.diesel);
  });

  it('casa por SUBCADENA, no solo por prefijo', async () => {
    // "Premium" está al final del nombre: un `startsWith` no lo encontraría.
    const s = await sugerir(`q=premium&category=${hijaSlug}`);
    expect(s.map((x) => x.slug)).toEqual([S.dieselPremium]);
  });

  // ── P6: los de 0 anuncios se sugieren igual, al final ────────────────────────

  it('P6 — un tag SIN anuncios se sugiere, al FINAL y con count 0', async () => {
    // ESTE es el test que justifica Postgres-first: una búsqueda de facetas no puede
    // devolver un valor que no está en el índice, así que este tag sería invisible.
    const s = await sugerir(`q=diesel&category=${hijaSlug}`);

    const sinUso = s.find((x) => x.slug === S.sinAnuncios);
    expect(sinUso).toBeDefined();
    expect(sinUso!.count).toBe(0);
    // Y va el último: los de 0 no encabezan la lista.
    expect(s[s.length - 1].slug).toBe(S.sinAnuncios);
  });

  // ── Conteos y orden ──────────────────────────────────────────────────────────

  it('los conteos vienen del índice y son los reales', async () => {
    const s = await sugerir(`q=diesel&category=${hijaSlug}`);
    expect(s.find((x) => x.slug === S.diesel)!.count).toBe(2);
    expect(s.find((x) => x.slug === S.dieselPremium)!.count).toBe(1);
  });

  it('ORDEN: por conteo descendente, no por el orden editorial', async () => {
    // De serie, conteo y orden editorial coinciden, así que no distinguirían nada. Se
    // INVIERTE el orden editorial: `dieselPremium` al principio del catálogo y `diesel`
    // al final. Si mandara el criterio editorial, saldría premium primero; como manda
    // el conteo, sigue saliendo `diesel` (2 anuncios) por delante.
    const setOrden = (id: string, orden: number) =>
      request(app.getHttpServer())
        .patch(`/api/admin/tags/${id}`).set(adminAuth()).send({ orden }).expect(200);

    await setOrden(tagIds.dieselPremium, 0);
    await setOrden(tagIds.diesel, 10);

    const s = await sugerir(`q=diesel&category=${hijaSlug}`);
    expect(s.map((x) => x.slug)).toEqual([S.diesel, S.dieselPremium, S.sinAnuncios]);

    await setOrden(tagIds.diesel, 0);
    await setOrden(tagIds.dieselPremium, 1);
  }, 30_000);

  it('el criterio editorial DESEMPATA cuando los conteos son iguales', async () => {
    // Dos tags con 0 anuncios: manda el `orden` del admin.
    const extra = await prisma.tag.create({
      data: { slug: `b4-diesel-extra-${stamp}`, name: 'Diesel Extra', orden: 99 },
    });
    await asignarTags(hijaId, [
      tagIds.diesel, tagIds.dieselPremium, tagIds.sinAnuncios, extra.id,
    ]);

    const s = await sugerir(`q=diesel&category=${hijaSlug}`);
    const ceros = s.filter((x) => x.count === 0).map((x) => x.slug);
    // `sinAnuncios` (orden 2) antes que `extra` (orden 99).
    expect(ceros).toEqual([S.sinAnuncios, extra.slug]);

    await asignarTags(hijaId, [tagIds.diesel, tagIds.dieselPremium, tagIds.sinAnuncios]);
    await prisma.tag.delete({ where: { id: extra.id } });
  }, 30_000);

  it('limit recorta DESPUÉS de ordenar: se queda con los más populares', async () => {
    const s = await sugerir(`q=diesel&category=${hijaSlug}&limit=1`);
    expect(s).toHaveLength(1);
    expect(s[0].slug).toBe(S.diesel);
  });

  // ── Ámbito por categoría ─────────────────────────────────────────────────────

  it('acotado por categoría: un tag de otra categoría NO se sugiere aquí', async () => {
    expect((await sugerir(`q=solo&category=${hijaSlug}`)).map((x) => x.slug)).toEqual([]);
    expect((await sugerir(`q=solo&category=${otraSlug}`)).map((x) => x.slug)).toEqual([S.deOtra]);
  });

  it('SIN categoría sugiere del catálogo global', async () => {
    const s = await sugerir('q=solo');
    expect(s.map((x) => x.slug)).toContain(S.deOtra);
  });

  it('HERENCIA: un tag del padre se sugiere en la hija', async () => {
    await asignarTags(padreId, [tagIds.deOtra]);
    const s = await sugerir(`q=solo&category=${hijaSlug}`);
    expect(s.map((x) => x.slug)).toContain(S.deOtra);
    await asignarTags(padreId, []);
  }, 30_000);

  it('una categoría inexistente no sugiere nada, en vez de caer al catálogo global', async () => {
    // Sugerir tags que el destino no ofrece sería peor que no sugerir.
    expect(await sugerir('q=diesel&category=no-existe-esta-categoria')).toEqual([]);
  });

  // ── q vacío ──────────────────────────────────────────────────────────────────

  it('q VACÍO con categoría: sus etiquetas, para descubrir de qué se puede hablar', async () => {
    const s = await sugerir(`q=&category=${hijaSlug}`);
    expect(s.length).toBeGreaterThan(0);
    expect(s.map((x) => x.slug)).toContain(S.diesel);
  });

  it('q VACÍO sin categoría: nada — el catálogo entero no es una sugerencia', async () => {
    expect(await sugerir('q=')).toEqual([]);
    expect(await sugerir('limit=8')).toEqual([]);
  });

  // ── Robustez ─────────────────────────────────────────────────────────────────

  it('un q HOSTIL no rompe ni inyecta', async () => {
    // Prisma parametriza `contains`, así que esto es texto, no SQL. Se comprueba que
    // responde 200 y que las etiquetas siguen existiendo después.
    const hostiles = [
      "'; DROP TABLE \"Tag\"; --",
      '%',
      '_',
      '100%',
      '\\',
      '"',
    ];
    for (const q of hostiles) {
      const res = await request(app.getHttpServer())
        .get(`/api/tags/suggest?q=${encodeURIComponent(q)}&category=${hijaSlug}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
    // La tabla sigue ahí y con sus filas.
    expect(await prisma.tag.count({ where: { id: { in: Object.values(tagIds) } } })).toBe(4);
  }, 30_000);

  it('un limit fuera de rango se rechaza con 400', async () => {
    await request(app.getHttpServer())
      .get(`/api/tags/suggest?q=diesel&limit=999`).expect(400);
    await request(app.getHttpServer())
      .get(`/api/tags/suggest?q=diesel&limit=0`).expect(400);
  });

  it('el endpoint es PÚBLICO: la portada la ve todo el mundo', async () => {
    // Sin cabecera de sesión.
    await request(app.getHttpServer())
      .get(`/api/tags/suggest?q=diesel&category=${hijaSlug}`).expect(200);
  });

  // ── Caché ────────────────────────────────────────────────────────────────────

  it('la segunda llamada idéntica se sirve de la caché', async () => {
    const q = `q=diesel&category=${hijaSlug}`;
    const primera = await sugerir(q);

    // Se cambia el catálogo POR DEBAJO, sin invalidar (escribiendo en la tabla, no por
    // el endpoint): si la respuesta cambiara, no habría caché.
    await prisma.tag.update({
      where: { id: tagIds.diesel },
      data: { name: 'Nombre Cambiado A Mano' },
    });

    expect(await sugerir(q)).toEqual(primera);

    await prisma.tag.update({ where: { id: tagIds.diesel }, data: { name: NOMBRES.diesel } });
  }, 30_000);
});
