/**
 * BÚSQUEDA+TAGS — RÁFAGA B3: el filtro por etiquetas.
 *
 * B2 indexó el campo y dejó `?tags=` dando 400 a propósito. B3 lo activa, y a
 * diferencia de B2 esto SÍ cambia qué anuncios salen.
 *
 * El corazón de la ráfaga es el AND: acumular etiquetas ACOTA. Se ejerce con tres
 * anuncios construidos justo para distinguir AND de OR — uno con cada tag por separado
 * y uno con los dos.
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

describe('Filtro por etiquetas (B3, e2e)', () => {
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
  const S = {
    diesel: `b3-diesel-${stamp}`,
    garantia: `b3-garantia-${stamp}`,
    soloOtra: `b3-solo-otra-${stamp}`,
    aDesactivar: `b3-a-desactivar-${stamp}`,
  };
  const tagIds: Record<string, string> = {};

  /** Los tres anuncios que distinguen AND de OR. */
  const ids: Record<'soloDiesel' | 'ambos' | 'soloGarantia' | 'sinTags', string> = {
    soloDiesel: '', ambos: '', soloGarantia: '', sinTags: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function asignarTags(categoryId: string, tagIdList: string[]) {
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${categoryId}/tags`).set(adminAuth())
      .send({ tagIds: tagIdList }).expect(200);
  }

  /** Crea y PUBLICA, y espera a que el documento esté en el índice. */
  async function publicar(titulo: string, tags: string[], categoryId = hijaId): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/listings').set(auth())
      .send({
        title: titulo,
        description: `Descripción de prueba para "${titulo}", suficientemente larga.`,
        price: 1000,
        type: 'PRODUCT',
        condition: 'GOOD',
        priceType: 'FIXED',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        // Coordenadas explícitas: sin ellas `create()` encola un geocode que reindexa,
        // y el documento se escribe dos veces (ver la nota de método de B2).
        latitude: 40.4168,
        longitude: -3.7038,
        tags,
      }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);
    return res.body.id as string;
  }

  /** GET /search y devuelve los ids de los hits. */
  async function buscar(qs: string): Promise<string[]> {
    const res = await request(app.getHttpServer()).get(`/api/search?${qs}`).expect(200);
    return (res.body.hits as { id: string }[]).map((h) => h.id);
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    const padre = await prisma.category.create({
      data: { name: 'B3 Padre', slug: `b3-padre-${stamp}`, order: 980, attributeSchema: [] },
    });
    padreId = padre.id;
    hijaSlug = `b3-hija-${stamp}`;
    const hija = await prisma.category.create({
      data: { name: 'B3 Hija', slug: hijaSlug, parentId: padre.id, order: 981, attributeSchema: [] },
    });
    hijaId = hija.id;
    otraSlug = `b3-otra-${stamp}`;
    const otra = await prisma.category.create({
      data: { name: 'B3 Otra', slug: otraSlug, order: 982, attributeSchema: [] },
    });
    otraId = otra.id;

    let orden = 0;
    for (const [clave, slug] of Object.entries(S)) {
      const tag = await prisma.tag.create({ data: { slug, name: `B3 ${clave}`, orden: orden++ } });
      tagIds[clave] = tag.id;
    }

    const email = `b3-seller-${stamp}@example.com`;
    const user = await prisma.user.create({
      data: {
        email, name: 'B3 Seller', slug: `b3-seller-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
    });
    sellerId = user.id;
    token = (await request(app.getHttpServer())
      .post('/api/auth/login').send({ email, password: 'Test1234!' })).body.accessToken;

    const adminEmail = `b3-admin-${stamp}@example.com`;
    const admin = await prisma.user.create({
      data: {
        email: adminEmail, name: 'B3 Admin', slug: `b3-admin-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
    });
    adminId = admin.id;
    adminToken = (await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: adminEmail, password: 'Test1234!' })).body.accessToken;

    await asignarTags(hijaId, [tagIds.diesel, tagIds.garantia, tagIds.aDesactivar]);
    await asignarTags(otraId, [tagIds.soloOtra, tagIds.garantia]);

    // EL TOPE SUBIDO SÓLO MIENTRAS SE PUBLICA, que es lo único que lo necesita: el
    // spec publica varios anuncios con el mismo vendedor FREE y toparía con la cuota
    // de activos. Los `it` de abajo sólo consultan, así que cuando el primero corre
    // la clave ya está restaurada.
    //
    // Antes se subía en el `beforeAll` y el `afterAll` la BORRABA. `Setting` es dato
    // compartido y `cleanDb` no lo toca, así que borrar no es restaurar: dejaba la
    // clave sin fila para el resto de la corrida. Que no rompiera nada era una
    // casualidad —el valor por defecto del código (5) coincide con el del seed (5)—,
    // no una garantía. `withSetting` devuelve la FILA EXACTA: el valor que hubiera,
    // o ninguna fila si no había ninguna.
    await withSetting(prisma, 'freeActiveListingLimit', 500, async () => {
      // El reparto que distingue AND de OR.
      ids.soloDiesel = await publicar('B3 Solo diesel', [S.diesel]);
      ids.ambos = await publicar('B3 Diesel con garantia', [S.diesel, S.garantia]);
      ids.soloGarantia = await publicar('B3 Solo garantia', [S.garantia]);
      ids.sinTags = await publicar('B3 Sin etiquetas', []);
    });
  }, 120_000);

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

  // ── El filtro ────────────────────────────────────────────────────────────────

  it('?tags= ya NO da 400: filtra de verdad', async () => {
    // El límite de B2 era exactamente esto. Aquí se cierra.
    const hits = await buscar(`category=${hijaSlug}&tags=${S.diesel}`);
    expect(hits).toContain(ids.soloDiesel);
    expect(hits).toContain(ids.ambos);
    expect(hits).not.toContain(ids.soloGarantia);
    expect(hits).not.toContain(ids.sinTags);
  });

  it('AND: dos etiquetas exigen las DOS, no cualquiera de ellas', async () => {
    // EL CORAZÓN DE B3. Con OR saldrían los tres; con AND, solo el que las tiene ambas.
    const hits = await buscar(`category=${hijaSlug}&tags=${S.diesel},${S.garantia}`);

    expect(hits).toContain(ids.ambos);
    expect(hits).not.toContain(ids.soloDiesel);
    expect(hits).not.toContain(ids.soloGarantia);
    expect(hits).toHaveLength(1);
  });

  it('acumular etiquetas ACOTA: el segundo filtro nunca amplía el resultado', async () => {
    const uno = await buscar(`category=${hijaSlug}&tags=${S.diesel}`);
    const dos = await buscar(`category=${hijaSlug}&tags=${S.diesel},${S.garantia}`);
    expect(dos.length).toBeLessThanOrEqual(uno.length);
    // Y lo que queda es un subconjunto de lo que había.
    for (const id of dos) expect(uno).toContain(id);
  });

  it('el orden de las etiquetas en la URL no cambia el resultado', async () => {
    const ab = await buscar(`category=${hijaSlug}&tags=${S.diesel},${S.garantia}`);
    const ba = await buscar(`category=${hijaSlug}&tags=${S.garantia},${S.diesel}`);
    expect(ba.sort()).toEqual(ab.sort());
  });

  it('etiquetas repetidas o con espacios no rompen ni cuentan dos veces', async () => {
    const hits = await buscar(
      `category=${hijaSlug}&tags=${S.diesel}%20,%20${S.diesel},,${S.garantia}`,
    );
    expect(hits).toEqual([ids.ambos]);
  });

  // ── Sin categoría: el vocabulario es GLOBAL ──────────────────────────────────

  it('SIN categoría: /search?tags= funciona y NO da 400', async () => {
    // A diferencia de un atributo, un tag no pertenece a una categoría: no pasa por la
    // validación scoped que protege del leak cross-categoría.
    const hits = await buscar(`tags=${S.diesel}`);
    expect(hits).toContain(ids.soloDiesel);
    expect(hits).toContain(ids.ambos);
    expect(hits).not.toContain(ids.soloGarantia);
  });

  it('un atributo ajeno a la categoría SIGUE dando 400 — el anti-leak intacto', async () => {
    // El requisito de oro: activar el filtro de tags no relaja la defensa de RÁFAGA 1.
    await request(app.getHttpServer())
      .get(`/api/search?category=${hijaSlug}&atributoQueNoExiste=3`).expect(400);
  });

  // ── Slugs desconocidos: se descartan, no rompen ──────────────────────────────

  it('un slug INEXISTENTE se ignora en silencio y devuelve el resto', async () => {
    const hits = await buscar(`category=${hijaSlug}&tags=${S.diesel},no-existe-este-tag`);
    // El filtro aplicado es solo `diesel`: el desconocido desaparece.
    expect(hits).toContain(ids.soloDiesel);
    expect(hits).toContain(ids.ambos);
    expect(hits).not.toContain(ids.soloGarantia);
  });

  it('SOLO un slug inexistente → búsqueda sin filtrar, no 0 resultados', async () => {
    // Un enlace viejo no debe devolver "no hay nada": eso es indistinguible de que la
    // búsqueda no tenga resultados, y el usuario no puede saber cuál de las dos es.
    const conBasura = await buscar(`category=${hijaSlug}&tags=no-existe-este-tag`);
    const sinNada = await buscar(`category=${hijaSlug}`);
    expect(conBasura.sort()).toEqual(sinNada.sort());
    expect(conBasura.length).toBeGreaterThan(0);
  });

  it('un tag DESACTIVADO se comporta como inexistente (el enlace viejo no rompe)', async () => {
    const conElTag = await publicar('B3 Con tag a desactivar', [S.aDesactivar]);

    // Antes de desactivar, filtra.
    expect(await buscar(`category=${hijaSlug}&tags=${S.aDesactivar}`)).toContain(conElTag);

    // Se desactiva por la vía real (invalida la caché del catálogo activo).
    await request(app.getHttpServer())
      .patch(`/api/admin/tags/${tagIds.aDesactivar}`).set(adminAuth())
      .send({ activo: false }).expect(200);

    const tras = await buscar(`category=${hijaSlug}&tags=${S.aDesactivar}`);
    const sinFiltro = await buscar(`category=${hijaSlug}`);
    expect(tras.sort()).toEqual(sinFiltro.sort());

    await request(app.getHttpServer())
      .patch(`/api/admin/tags/${tagIds.aDesactivar}`).set(adminAuth())
      .send({ activo: true }).expect(200);
  }, 60_000);

  // ── La faceta ────────────────────────────────────────────────────────────────

  it('la respuesta trae facets.tags con los conteos por slug', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/search?category=${hijaSlug}`).expect(200);

    expect(res.body.facets).toBeDefined();
    expect(res.body.facets.tags).toBeDefined();
    // 2 anuncios llevan diesel (soloDiesel y ambos), 2 llevan garantia.
    expect(res.body.facets.tags[S.diesel]).toBe(2);
    expect(res.body.facets.tags[S.garantia]).toBe(2);
  });

  it('la faceta se recalcula con el filtro aplicado', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/search?category=${hijaSlug}&tags=${S.diesel}`).expect(200);
    // Dentro de los que llevan diesel, solo uno lleva además garantia.
    expect(res.body.facets.tags[S.garantia]).toBe(1);
  });

  // ── Requisito de oro: sin ?tags= nada cambia ─────────────────────────────────

  it('SIN ?tags= los hits son exactamente los de siempre', async () => {
    const hits = await buscar(`category=${hijaSlug}`);
    for (const id of [ids.soloDiesel, ids.ambos, ids.soloGarantia, ids.sinTags]) {
      expect(hits).toContain(id);
    }
  });

  it('tags CONVIVE con los demás filtros, no los sustituye', async () => {
    // Un filtro core (precio) y el de tags a la vez: los dos aplican.
    const conPrecioAlto = await buscar(`category=${hijaSlug}&tags=${S.diesel}&minPrice=99999`);
    expect(conPrecioAlto).toHaveLength(0);

    const conPrecioOk = await buscar(`category=${hijaSlug}&tags=${S.diesel}&minPrice=1`);
    expect(conPrecioOk).toContain(ids.ambos);
  });

  it('tags + categoría: el filtro de categoría sigue acotando', async () => {
    // `garantia` es efectivo en las dos categorías, pero el anuncio está en la hija.
    const enOtra = await buscar(`category=${otraSlug}&tags=${S.garantia}`);
    expect(enOtra).not.toContain(ids.ambos);
    expect(enOtra).not.toContain(ids.soloGarantia);
  });
});
