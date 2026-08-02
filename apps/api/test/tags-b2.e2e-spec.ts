/**
 * BÚSQUEDA+TAGS — RÁFAGA B2: tags en el anuncio (wizard + validación + indexación).
 *
 * B1 construyó el vocabulario; aquí EMPIEZA A USARSE. Lo que se ejerce:
 *  · publicar con tags → se guardan, se devuelven en la ficha, se indexan;
 *  · el tope CONFIGURABLE (no solo el default) y la pertenencia a la categoría;
 *  · el grandfathering — bajar el tope no rompe anuncios vivos;
 *  · el cambio de categoría — poda en silencio, no 422;
 *  · el límite de B2: se INDEXA pero NO se filtra (eso es B3).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient } from './helpers/db';
import { waitForIndex } from './helpers/meili';

const INDEX = process.env.MEILI_INDEX_NAME ?? 'listings_test';

describe('Tags en el anuncio (B2, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let token: string;
  let sellerId: string;

  // Árbol propio para no depender del seed en las pruebas de herencia/ajenos.
  let padreId: string;
  let hijaId: string;
  let hijaSlug: string;
  let otraId: string; // la "categoría destino" del cambio de categoría
  let otraSlug: string;

  // Catálogo propio del spec.
  const tagIds: Record<string, string> = {};
  const stamp = Date.now();
  const S = {
    padre: `b2-del-padre-${stamp}`,
    hija: `b2-de-la-hija-${stamp}`,
    hija2: `b2-de-la-hija-dos-${stamp}`,
    otra: `b2-de-la-otra-${stamp}`,
    huerfano: `b2-sin-categoria-${stamp}`,
  };

  let adminToken: string;
  let adminId: string;
  let limiteFreePrevio: unknown = null;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  /**
   * Asigna tags a una categoría POR LA VÍA REAL (endpoint admin), no escribiendo
   * CategoryTag a pelo.
   *
   * No es cosmética: `effectiveTagsForCategory` cachea en Redis 300 s por slug, y solo
   * `setCategoryTags` invalida. Escribiendo la tabla directamente, un test que asigna
   * un tag y acto seguido publica con él veía el set efectivo VIEJO y fallaba con
   * "etiqueta no válida" — un rojo que no dice nada del producto, solo del atajo.
   */
  async function asignarTags(categoryId: string, ids: string[]) {
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${categoryId}/tags`).set(adminAuth())
      .send({ tagIds: ids }).expect(200);
  }

  /** Los ids que una categoría tiene asignados AHORA (para añadir sin pisar). */
  async function tagsDe(categoryId: string): Promise<string[]> {
    const filas = await prisma.categoryTag.findMany({
      where: { categoryId }, select: { tagId: true },
    });
    return filas.map((f) => f.tagId);
  }

  /** El tope se toca por la MISMA vía que el admin: el Setting. */
  async function setTope(valor: number | null) {
    if (valor === null) {
      await prisma.setting.deleteMany({ where: { key: 'maxTagsPerListing' } });
    } else {
      await prisma.setting.upsert({
        where: { key: 'maxTagsPerListing' },
        create: { key: 'maxTagsPerListing', value: valor },
        update: { value: valor },
      });
    }
  }

  function payload(titulo: string, extra: Record<string, unknown> = {}) {
    return {
      title: titulo,
      description: `Descripción de prueba para "${titulo}", suficientemente larga.`,
      price: 1000,
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      categoryId: hijaId,
      city: 'Madrid',
      province: 'Madrid',
      // Coordenadas EXPLÍCITAS a propósito. Sin ellas, `create()` encola un job de
      // `geocode` que al terminar REINDEXA, así que cada anuncio se escribe en
      // Meilisearch dos veces: `waitForIndex` (que solo espera a que el documento
      // exista) devolvía la primera versión y el test leía un documento que aún
      // podía cambiar. Se descubrió porque una validación por mutación salía verde
      // por casualidad de tiempos. Con coordenadas, el único job es el de `publish`
      // y lo que se lee es lo definitivo.
      latitude: 40.4168,
      longitude: -3.7038,
      ...extra,
    };
  }

  /** Devuelve el Test de supertest (no una Promise), para poder encadenar .expect(). */
  function crearAnuncio(titulo: string, extra: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/listings').set(auth()).send(payload(titulo, extra));
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    const padre = await prisma.category.create({
      data: { name: 'B2 Padre', slug: `b2-padre-${stamp}`, order: 990, attributeSchema: [] },
    });
    padreId = padre.id;
    hijaSlug = `b2-hija-${stamp}`;
    const hija = await prisma.category.create({
      data: { name: 'B2 Hija', slug: hijaSlug, parentId: padre.id, order: 991, attributeSchema: [] },
    });
    hijaId = hija.id;
    otraSlug = `b2-otra-${stamp}`;
    const otra = await prisma.category.create({
      data: { name: 'B2 Otra', slug: otraSlug, order: 992, attributeSchema: [] },
    });
    otraId = otra.id;

    let orden = 0;
    for (const [clave, slug] of Object.entries(S)) {
      const tag = await prisma.tag.create({
        data: { slug, name: `B2 ${clave}`, orden: orden++ },
      });
      tagIds[clave] = tag.id;
    }

    // padre → del-padre  (la hija lo HEREDA)
    // hija  → de-la-hija, de-la-hija-dos
    // otra  → de-la-otra
    // huerfano no cuelga de ninguna categoría: existe en el catálogo y nadie lo ofrece.
    await prisma.categoryTag.createMany({
      data: [
        { categoryId: padreId, tagId: tagIds.padre, orden: 0 },
        { categoryId: hijaId, tagId: tagIds.hija, orden: 0 },
        { categoryId: hijaId, tagId: tagIds.hija2, orden: 1 },
        { categoryId: otraId, tagId: tagIds.otra, orden: 0 },
      ],
    });

    const email = `b2-seller-${stamp}@example.com`;
    const user = await prisma.user.create({
      data: {
        email, name: 'B2 Seller', slug: `b2-seller-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
    });
    sellerId = user.id;
    token = (await request(app.getHttpServer())
      .post('/api/auth/login').send({ email, password: 'Test1234!' })).body.accessToken;

    const adminEmail = `b2-admin-${stamp}@example.com`;
    const admin = await prisma.user.create({
      data: {
        email: adminEmail, name: 'B2 Admin', slug: `b2-admin-${stamp}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
    });
    adminId = admin.id;
    adminToken = (await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: adminEmail, password: 'Test1234!' })).body.accessToken;

    // El spec publica una docena de anuncios con el MISMO vendedor FREE, así que
    // choca con `freeActiveListingLimit` (403) por acumulación, no por nada que tenga
    // que ver con los tags. Se sube para la suite y se restaura al terminar; se
    // guarda el valor previo en vez de asumir el del seed.
    limiteFreePrevio =
      (await prisma.setting.findUnique({ where: { key: 'freeActiveListingLimit' } }))?.value ?? null;
    await prisma.setting.upsert({
      where: { key: 'freeActiveListingLimit' },
      create: { key: 'freeActiveListingLimit', value: 500 },
      update: { value: 500 },
    });
  }, 60_000);

  afterEach(async () => {
    // El tope vuelve a "sin configurar" tras cada test: es el estado base y así los
    // tests no dependen del orden.
    await setTope(null);
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { sellerId } });
    // El admin del spec deja AuditLog (TAG_EDIT, CATEGORY_EDIT); AuditLog.actorId no
    // es cascade, así que hay que quitarlos antes de borrar el usuario.
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [sellerId, adminId] } } });
    await prisma.categoryTag.deleteMany({
      where: { categoryId: { in: [padreId, hijaId, otraId] } },
    });
    await prisma.tag.deleteMany({ where: { id: { in: Object.values(tagIds) } } });
    await prisma.category.deleteMany({ where: { id: { in: [hijaId, otraId, padreId] } } });
    await setTope(null);
    if (limiteFreePrevio === null) {
      await prisma.setting.deleteMany({ where: { key: 'freeActiveListingLimit' } });
    } else {
      await prisma.setting.update({
        where: { key: 'freeActiveListingLimit' },
        data: { value: limiteFreePrevio as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ── Alta con tags ────────────────────────────────────────────────────────────

  it('publica con tags → se guardan, salen en la ficha y llegan al índice', async () => {
    const res = await crearAnuncio('B2 Con tres tags', {
      tags: [S.hija, S.hija2, S.padre],
    }).expect(201);
    const id = res.body.id as string;

    // 1. Las filas puente existen.
    const filas = await prisma.listingTag.findMany({ where: { listingId: id } });
    expect(filas).toHaveLength(3);

    // 2. La ficha pública los devuelve como TagRef[].
    await request(app.getHttpServer()).post(`/api/listings/${id}/publish`).set(auth()).expect(200);
    const ficha = await request(app.getHttpServer())
      .get(`/api/listings/${res.body.slug}`).expect(200);
    const slugs = (ficha.body.tags as { slug: string; name: string; id: string }[]).map((t) => t.slug);
    expect(slugs.sort()).toEqual([S.hija, S.hija2, S.padre].sort());
    expect(ficha.body.tags[0]).toHaveProperty('name');

    // 3. El documento de Meilisearch lleva AMBOS arrays.
    await waitForIndex(meili, INDEX, id);
    const doc = (await meili.index(INDEX).getDocument(id)) as unknown as {
      tags: string[]; tagNames: string[];
    };
    expect(doc.tags.sort()).toEqual([S.hija, S.hija2, S.padre].sort());
    expect(doc.tagNames).toHaveLength(3);
    expect(doc.tagNames).toContain('B2 hija');
  }, 30_000);

  it('sin tags: se publica igual y el documento lleva arrays vacíos', async () => {
    // Los tags NO son obligatorios: nunca bloquean por falta.
    const res = await crearAnuncio('B2 Sin tags').expect(201);
    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);

    const doc = (await meili.index(INDEX).getDocument(res.body.id)) as unknown as {
      tags: string[]; tagNames: string[];
    };
    expect(doc.tags).toEqual([]);
    expect(doc.tagNames).toEqual([]);
  }, 30_000);

  it('HERENCIA: un tag del PADRE se acepta al publicar en la HIJA', async () => {
    const res = await crearAnuncio('B2 Solo heredado', { tags: [S.padre] }).expect(201);
    const filas = await prisma.listingTag.findMany({ where: { listingId: res.body.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0].tagId).toBe(tagIds.padre);
  });

  it('los duplicados no cuentan dos veces ni revientan la clave compuesta', async () => {
    const res = await crearAnuncio('B2 Duplicado', { tags: [S.hija, S.hija, S.hija] }).expect(201);
    expect(await prisma.listingTag.count({ where: { listingId: res.body.id } })).toBe(1);
  });

  // ── Validación: pertenencia y tope ───────────────────────────────────────────

  it('un tag AJENO a la categoría → 422', async () => {
    // `de-la-otra` existe y está activo, pero su categoría no es esta.
    const res = await crearAnuncio('B2 Tag ajeno', { tags: [S.otra] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain(S.otra);
  });

  it('un tag del catálogo que NINGUNA categoría ofrece → 422', async () => {
    const res = await crearAnuncio('B2 Tag huérfano', { tags: [S.huerfano] });
    expect(res.status).toBe(422);
  });

  it('un tag DESACTIVADO deja de aceptarse aunque sea de la categoría', async () => {
    // Se desactiva por la VÍA REAL (el endpoint admin), no escribiendo en la tabla:
    // es la que invalida la caché de tags efectivos. Escribiéndolo a mano el test
    // pasaría o no según el TTL, que es justo la clase de fragilidad a evitar.
    const setActivo = (activo: boolean) =>
      request(app.getHttpServer())
        .patch(`/api/admin/tags/${tagIds.hija2}`).set(adminAuth()).send({ activo }).expect(200);

    await setActivo(false);
    const res = await crearAnuncio('B2 Tag inactivo', { tags: [S.hija2] });
    expect(res.status).toBe(422);

    await setActivo(true);
    // Y al reactivarlo vuelve a aceptarse: el 422 era por `activo`, no por otra cosa.
    await crearAnuncio('B2 Tag reactivado', { tags: [S.hija2] }).expect(201);
  }, 30_000);

  it('TOPE por DEFECTO (5, sin fila): 6 tags → 422 con el tope en el mensaje', async () => {
    // Se crean 6 tags válidos para la categoría, solo para este test.
    const extra: string[] = [];
    const nuevos: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await prisma.tag.create({
        data: { slug: `b2-tope-${stamp}-${i}`, name: `B2 Tope ${i}`, orden: 50 + i },
      });
      nuevos.push(t.id);
      extra.push(t.slug);
    }
    await asignarTags(hijaId, [...(await tagsDe(hijaId)), ...nuevos]);

    const res = await crearAnuncio('B2 Seis tags', { tags: extra });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/máximo 5/);

    // Con 5 pasa: el rechazo es por el tope, no por otra cosa.
    await crearAnuncio('B2 Cinco tags', { tags: extra.slice(0, 5) }).expect(201);

    await asignarTags(hijaId, (await tagsDe(hijaId)).filter((id) => !nuevos.includes(id)));
    await prisma.listingTag.deleteMany({ where: { tagId: { in: nuevos } } });
    await prisma.tag.deleteMany({ where: { id: { in: nuevos } } });
  }, 30_000);

  it('TOPE CONFIGURABLE: bajarlo a 3 hace que 4 tags den 422 con el tope NUEVO', async () => {
    // El punto del test: el tope que se aplica es el del Setting, no la constante.
    const cuarto = await prisma.tag.create({
      data: { slug: `b2-cuarto-${stamp}`, name: 'B2 Cuarto', orden: 40 },
    });
    await asignarTags(hijaId, [...(await tagsDe(hijaId)), cuarto.id]);
    const cuatro = [S.hija, S.hija2, S.padre, cuarto.slug];

    // Con el tope por defecto (5) los cuatro pasan.
    await crearAnuncio('B2 Cuatro con tope 5', { tags: cuatro }).expect(201);

    await setTope(3);
    const res = await crearAnuncio('B2 Cuatro con tope 3', { tags: cuatro });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/máximo 3/);

    await asignarTags(hijaId, (await tagsDe(hijaId)).filter((id) => id !== cuarto.id));
    await prisma.listingTag.deleteMany({ where: { tagId: cuarto.id } });
    await prisma.tag.delete({ where: { id: cuarto.id } });
  }, 30_000);

  // ── Edición: disparador por-campo y grandfathering ───────────────────────────

  it('GRANDFATHERING: bajar el tope no rompe un PATCH que no toca los tags', async () => {
    const res = await crearAnuncio('B2 Grandfathering', {
      tags: [S.hija, S.hija2, S.padre],
    }).expect(201);
    const id = res.body.id as string;

    // El tope baja POR DEBAJO de lo que el anuncio ya tiene.
    await setTope(1);

    // Un PATCH de solo PRECIO: no debe revalidar tags.
    await request(app.getHttpServer())
      .patch(`/api/listings/${id}`).set(auth()).send({ price: 2222 }).expect(200);

    // Y los tags siguen ahí, los tres.
    expect(await prisma.listingTag.count({ where: { listingId: id } })).toBe(3);

    // En cambio, un PATCH que SÍ toca los tags se somete al tope nuevo.
    const rechazo = await request(app.getHttpServer())
      .patch(`/api/listings/${id}`).set(auth()).send({ tags: [S.hija, S.hija2] });
    expect(rechazo.status).toBe(422);
    expect(JSON.stringify(rechazo.body)).toMatch(/máximo 1/);
  }, 30_000);

  it('un PATCH con tags:[] los quita todos (ausente ≠ vacío)', async () => {
    const res = await crearAnuncio('B2 Vaciar tags', { tags: [S.hija] }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth()).send({ tags: [] }).expect(200);
    expect(await prisma.listingTag.count({ where: { listingId: res.body.id } })).toBe(0);
  });

  it('un PATCH con tags REEMPLAZA el set, no lo acumula', async () => {
    const res = await crearAnuncio('B2 Reemplazo', { tags: [S.hija, S.hija2] }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth()).send({ tags: [S.padre] }).expect(200);

    const filas = await prisma.listingTag.findMany({ where: { listingId: res.body.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0].tagId).toBe(tagIds.padre);
  });

  // ── Cambio de categoría: poda en silencio ────────────────────────────────────

  it('CAMBIO DE CATEGORÍA: los tags que no aplican se PODAN, la edición NO se rechaza', async () => {
    const res = await crearAnuncio('B2 Mudanza', { tags: [S.hija, S.padre] }).expect(201);
    const id = res.body.id as string;

    // A `otra`, que no ofrece ni `de-la-hija` ni `del-padre`.
    await request(app.getHttpServer())
      .patch(`/api/listings/${id}`).set(auth()).send({ categoryId: otraId }).expect(200);

    expect(await prisma.listingTag.count({ where: { listingId: id } })).toBe(0);
  });

  it('al mudarse, los tags que SÍ aplican en el destino se conservan', async () => {
    // Se le da a `otra` uno de los tags de la hija: el que sobrevive a la mudanza.
    await asignarTags(otraId, [...(await tagsDe(otraId)), tagIds.hija]);

    const res = await crearAnuncio('B2 Mudanza parcial', { tags: [S.hija, S.padre] }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth()).send({ categoryId: otraId }).expect(200);

    const filas = await prisma.listingTag.findMany({ where: { listingId: res.body.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0].tagId).toBe(tagIds.hija);

    await asignarTags(otraId, [tagIds.otra]);
  });

  it('mudarse con MÁS tags que el tope tampoco rompe: la poda nunca suma', async () => {
    const res = await crearAnuncio('B2 Mudanza con tope bajo', {
      tags: [S.hija, S.hija2, S.padre],
    }).expect(201);
    await asignarTags(otraId, [tagIds.otra, tagIds.hija, tagIds.hija2, tagIds.padre]);
    await setTope(1);

    await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth()).send({ categoryId: otraId }).expect(200);
    expect(await prisma.listingTag.count({ where: { listingId: res.body.id } })).toBe(3);

    await asignarTags(otraId, [tagIds.otra]);
  }, 30_000);

  it('si el PATCH manda tags Y categoría, se validan contra la categoría NUEVA', async () => {
    const res = await crearAnuncio('B2 Tags y categoría', { tags: [S.hija] }).expect(201);

    // `de-la-hija` no vale en `otra` → 422, porque el usuario SÍ eligió estos tags.
    const rechazo = await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth())
      .send({ categoryId: otraId, tags: [S.hija] });
    expect(rechazo.status).toBe(422);

    // Con el tag correcto del destino, pasa.
    await request(app.getHttpServer())
      .patch(`/api/listings/${res.body.id}`).set(auth())
      .send({ categoryId: otraId, tags: [S.otra] }).expect(200);
  });

  // ── Reindexación tras editar ─────────────────────────────────────────────────

  it('editar los tags de un anuncio publicado actualiza el documento', async () => {
    const res = await crearAnuncio('B2 Reindexado', { tags: [S.hija] }).expect(201);
    const id = res.body.id as string;
    await request(app.getHttpServer()).post(`/api/listings/${id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, id);

    await request(app.getHttpServer())
      .patch(`/api/listings/${id}`).set(auth()).send({ tags: [S.padre, S.hija2] }).expect(200);

    // El reindexado va por cola: se espera a que el documento refleje el cambio.
    const deadline = Date.now() + 15_000;
    let doc = (await meili.index(INDEX).getDocument(id)) as unknown as { tags: string[] };
    while (Date.now() < deadline && !doc.tags.includes(S.padre)) {
      await new Promise((r) => setTimeout(r, 300));
      doc = (await meili.index(INDEX).getDocument(id)) as unknown as { tags: string[] };
    }
    expect(doc.tags.sort()).toEqual([S.hija2, S.padre].sort());
  }, 40_000);

  // ── Nombres reservados ───────────────────────────────────────────────────────

  /**
   * RESERVADO — ojo con lo que este test afirma y lo que NO.
   *
   * El admin NO devuelve 400 al crear un atributo llamado `tags`: la reserva del
   * nombre no es una validación de escritura, sino un filtro en
   * `FilterableAttributesResolver.toMap`, que SALTA los nombres reservados al
   * construir el mapa de atributos filtrables. Se comprobó ejerciéndolo: el PATCH
   * devuelve 200 (ver la nota de la ráfaga en estado-tecnico.md).
   *
   * Aquí se ejerce la protección que sí es observable de punta a punta: un atributo
   * llamado `tags` NUNCA se convierte en filtro, porque el resolver lo salta.
   *
   * La OTRA protección —que el campo core gane al atributo en el documento— se prueba
   * en `search.service.todocument.spec.ts`, como test unitario. No por comodidad:
   * medirla aquí resultó ser una carrera. La aserción salía verde o roja según cuándo
   * llegara a leer el documento, y con la mutación puesta (emitir `tags` antes del
   * spread) el e2e pasaba igual. El orden de las claves de un objeto es lógica pura;
   * comprobarlo tras una cola BullMQ y un índice asíncrono mide los tiempos, no el
   * código.
   */
  it('RESERVADO: un atributo llamado `tags` ni filtra ni pisa el campo del documento', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${hijaId}`).set(adminAuth())
      .send({
        attributeSchema: [
          { name: 'tags', label: 'Colisión', type: 'text', filterable: true, required: false },
        ],
      }).expect(200);

    // 1. El atributo NO se registra como filtro de categoría: el resolver lo saltó.
    //    Se comprueba por el lado que sigue siendo observable tras B3 — `tags` es un
    //    parámetro CORE (el filtro de etiquetas), y su valor se interpreta como slug de
    //    etiqueta, nunca como valor del atributo. `valor-del-atributo` no es ninguna
    //    etiqueta, así que se descarta y la búsqueda no queda filtrada por él.
    //
    //    (En B2 esto se comprobaba con un 400, porque `?tags=` aún no filtraba. B3
    //    activó el filtro, así que el 400 ya no es la señal correcta.)
    const conAtributo = await request(app.getHttpServer())
      .get(`/api/search?category=${hijaSlug}&tags=valor-del-atributo`).expect(200);
    const sinNada = await request(app.getHttpServer())
      .get(`/api/search?category=${hijaSlug}`).expect(200);
    expect(conAtributo.body.totalHits).toBe(sinNada.body.totalHits);

    // 2. Un anuncio puede llevar el atributo Y tags de verdad, y se guarda sin drama:
    //    la colisión es de NOMBRES en el documento, no de datos en Postgres.
    const res = await crearAnuncio('B2 Colisión de nombres', {
      attributes: { tags: 'valor-del-atributo' },
      tags: [S.hija],
    }).expect(201);
    expect(await prisma.listingTag.count({ where: { listingId: res.body.id } })).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${hijaId}`).set(adminAuth())
      .send({ attributeSchema: [] }).expect(200);
  }, 40_000);

  // ── Lo que B2 indexa, B3 ya lo filtra ────────────────────────────────────────

  it('el campo indexado es el que usa el filtro de B3', async () => {
    // En B2 este test afirmaba lo contrario —`?tags=` daba 400— porque el filtro no
    // existía. B3 lo activó, así que aquí se comprueba lo que B2 sí garantiza y sigue
    // siendo suyo: que lo que se INDEXA es lo que el filtro encuentra. El filtro en sí
    // (AND, CSV, slugs desconocidos) se prueba en `tags-b3.e2e-spec.ts`.
    const res = await crearAnuncio('B2 Indexado y filtrable', { tags: [S.hija] }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);

    const busqueda = await request(app.getHttpServer())
      .get(`/api/search?tags=${S.hija}`).expect(200);
    expect(busqueda.body.hits.some((h: { id: string }) => h.id === res.body.id)).toBe(true);
  }, 30_000);

  it('la búsqueda SIN ?tags= devuelve lo mismo que antes de indexar el campo', async () => {
    const res = await crearAnuncio('B2 Búsqueda intacta unicornio').expect(201);
    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);

    const busqueda = await request(app.getHttpServer())
      .get('/api/search?q=unicornio').expect(200);
    expect(busqueda.body.hits.some((h: { id: string }) => h.id === res.body.id)).toBe(true);
  }, 30_000);

  it('tagNames alimenta la relevancia de texto libre (searchable, no filtro)', async () => {
    const tag = await prisma.tag.create({
      data: { slug: `b2-hidroneumatica-${stamp}`, name: 'Hidroneumatica', orden: 70 },
    });
    await asignarTags(hijaId, [...(await tagsDe(hijaId)), tag.id]);

    // El título y la descripción NO contienen la palabra: si aparece en la búsqueda,
    // es por tagNames.
    const res = await crearAnuncio('B2 Coche gris', { tags: [tag.slug] }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/listings/${res.body.id}/publish`).set(auth()).expect(200);
    await waitForIndex(meili, INDEX, res.body.id);

    const busqueda = await request(app.getHttpServer())
      .get('/api/search?q=Hidroneumatica').expect(200);
    expect(busqueda.body.hits.some((h: { id: string }) => h.id === res.body.id)).toBe(true);

    await asignarTags(hijaId, (await tagsDe(hijaId)).filter((id) => id !== tag.id));
    await prisma.listingTag.deleteMany({ where: { tagId: tag.id } });
    await prisma.tag.delete({ where: { id: tag.id } });
  }, 30_000);
});
