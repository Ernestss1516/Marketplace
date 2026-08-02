/**
 * BÚSQUEDA+TAGS — RÁFAGA B1: modelo Tag, herencia y CRUD admin.
 *
 * El cimiento del sistema nuevo. Aquí NADIE usa los tags todavía (los anuncios son B2,
 * la búsqueda B3, la portada B4): lo que se ejerce es que el admin pueda gestionar el
 * catálogo, asignarlo a categorías, y que la HERENCIA padre→hija funcione al leerlo.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

interface TagRef { id: string; slug: string; name: string }

describe('Tags — modelo, herencia y CRUD admin (B1, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let moderatorToken: string;

  let padreId: string;
  let hijaId: string;
  let padreSlug: string;
  let hijaSlug: string;
  const tagsCreados: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const hash = (pw: string) => bcrypt.hash(pw, 4);
    await prisma.user.upsert({
      where: { email: 'b1-admin@example.com' },
      create: {
        email: 'b1-admin@example.com', name: 'B1 Admin', slug: 'b1-admin',
        passwordHash: await hash('Test1234!'), emailVerified: true, role: 'ADMIN',
      },
      update: { role: 'ADMIN' },
    });
    await prisma.user.upsert({
      where: { email: 'b1-mod@example.com' },
      create: {
        email: 'b1-mod@example.com', name: 'B1 Mod', slug: 'b1-mod',
        passwordHash: await hash('Test1234!'), emailVerified: true, role: 'MODERATOR',
      },
      update: { role: 'MODERATOR' },
    });

    adminToken = (await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'b1-admin@example.com', password: 'Test1234!' })).body.accessToken;
    moderatorToken = (await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'b1-mod@example.com', password: 'Test1234!' })).body.accessToken;

    const stamp = Date.now();
    padreSlug = `b1-padre-${stamp}`;
    hijaSlug = `b1-hija-${stamp}`;
    const padre = await prisma.category.create({
      data: { name: 'B1 Padre', slug: padreSlug, attributeSchema: [] },
    });
    padreId = padre.id;
    const hija = await prisma.category.create({
      data: { name: 'B1 Hija', slug: hijaSlug, parentId: padre.id, attributeSchema: [] },
    });
    hijaId = hija.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.categoryTag.deleteMany({ where: { categoryId: { in: [padreId, hijaId] } } });
    await prisma.tag.deleteMany({ where: { id: { in: tagsCreados } } });
    await prisma.category.deleteMany({ where: { slug: hijaSlug } });
    await prisma.category.deleteMany({ where: { slug: padreSlug } });
    await app.close();
    await prisma.$disconnect();
  });

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  async function crearTag(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/api/admin/tags').set(admin()).send(body);
    if (res.status === 201) tagsCreados.push(res.body.id as string);
    return res;
  }

  // ── Catálogo global ─────────────────────────────────────────────────────────

  it('crea un tag y aparece en el catálogo', async () => {
    const res = await crearTag({ name: `B1 Garantía ${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ activo: true, orden: 0 });

    const lista = await request(app.getHttpServer())
      .get('/api/admin/tags').set(admin()).expect(200);
    expect((lista.body.items as TagRef[]).some((t) => t.id === res.body.id)).toBe(true);
  });

  it('el slug se DERIVA del nombre si no se indica (sin acentos ni espacios)', async () => {
    const res = await crearTag({ name: `Envío Incluido ${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.slug).toMatch(/^envio-incluido-\d+$/);
  });

  it('acepta un slug explícito cuando el derivado no sirve', async () => {
    const res = await crearTag({ name: '4x4', slug: `b1-cuatro-por-cuatro-${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.slug).toMatch(/^b1-cuatro-por-cuatro-/);
  });

  it('un slug DUPLICADO da 409 con el slug en el mensaje', async () => {
    const slug = `b1-dup-${Date.now()}`;
    await crearTag({ name: 'B1 Dup', slug }).then((r) => expect(r.status).toBe(201));

    const res = await crearTag({ name: 'B1 Dup otra vez', slug });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(slug);
  });

  it('rechaza un slug con formato inválido (mayúsculas, espacios)', async () => {
    expect((await crearTag({ name: 'X', slug: 'Con Mayúsculas' })).status).toBe(400);
  });

  it('busca por nombre con ?q=', async () => {
    const nombre = `B1 Buscable ${Date.now()}`;
    await crearTag({ name: nombre });

    const res = await request(app.getHttpServer())
      .get('/api/admin/tags?q=B1 Buscable').set(admin()).expect(200);
    expect((res.body.items as TagRef[]).some((t) => t.name === nombre)).toBe(true);
  });

  it('renombra con PATCH — y el slug NO cambia (es la URL y lo indexado)', async () => {
    const creado = await crearTag({ name: `B1 Renombrar ${Date.now()}` });
    const slugOriginal = creado.body.slug as string;

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/tags/${creado.body.id}`).set(admin())
      .send({ name: 'B1 Nombre nuevo' }).expect(200);

    expect(res.body.name).toBe('B1 Nombre nuevo');
    expect(res.body.slug).toBe(slugOriginal);
  });

  it('el slug NO se puede cambiar por PATCH (no está en el DTO; se ignora)', async () => {
    const creado = await crearTag({ name: `B1 Slug fijo ${Date.now()}` });
    const slugOriginal = creado.body.slug as string;

    await request(app.getHttpServer())
      .patch(`/api/admin/tags/${creado.body.id}`).set(admin())
      .send({ slug: 'intento-de-cambio' }).expect(400); // whitelist del ValidationPipe

    const despues = await prisma.tag.findUniqueOrThrow({ where: { id: creado.body.id } });
    expect(despues.slug).toBe(slugOriginal);
  });

  it('reordena en lote (ruta estática `reorder`, no capturada como :id)', async () => {
    const a = await crearTag({ name: `B1 Ord A ${Date.now()}` });
    const b = await crearTag({ name: `B1 Ord B ${Date.now()}` });

    await request(app.getHttpServer())
      .patch('/api/admin/tags/reorder').set(admin())
      .send({ items: [{ id: a.body.id, orden: 7 }, { id: b.body.id, orden: 3 }] })
      .expect(200);

    expect((await prisma.tag.findUniqueOrThrow({ where: { id: a.body.id } })).orden).toBe(7);
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: b.body.id } })).orden).toBe(3);
  });

  it('NO existe DELETE de tags — solo desactivación', async () => {
    const creado = await crearTag({ name: `B1 Sin delete ${Date.now()}` });
    await request(app.getHttpServer())
      .delete(`/api/admin/tags/${creado.body.id}`).set(admin())
      .expect(404); // ninguna ruta lo maneja
  });

  // ── Uso y desactivación ─────────────────────────────────────────────────────

  it('usage cuenta anuncios y categorías afectadas', async () => {
    const creado = await crearTag({ name: `B1 Uso ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [creado.body.id] }).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/admin/tags/${creado.body.id}/usage`).set(admin()).expect(200);
    expect(res.body).toEqual({ listingCount: 0, categoryCount: 1 });
  });

  it('DESACTIVAR un tag en uso se PERMITE, y deja de ofrecerse', async () => {
    const creado = await crearTag({ name: `B1 Desactivable ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [creado.body.id] }).expect(200);

    // Antes: se ofrece.
    let ofrecidos = (await request(app.getHttpServer())
      .get(`/api/categories/${padreSlug}/tags`).expect(200)).body as TagRef[];
    expect(ofrecidos.some((t) => t.id === creado.body.id)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/admin/tags/${creado.body.id}`).set(admin())
      .send({ activo: false }).expect(200);

    // Después: no se ofrece, pero la fila de CategoryTag sigue ahí (no se borra nada).
    ofrecidos = (await request(app.getHttpServer())
      .get(`/api/categories/${padreSlug}/tags`).expect(200)).body as TagRef[];
    expect(ofrecidos.some((t) => t.id === creado.body.id)).toBe(false);
    expect(await prisma.categoryTag.count({ where: { tagId: creado.body.id } })).toBe(1);
  });

  // ── Herencia (el corazón de B1) ─────────────────────────────────────────────

  it('LA HERENCIA: un tag del PADRE se ofrece en la HIJA', async () => {
    const delPadre = await crearTag({ name: `B1 Del padre ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [delPadre.body.id] }).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/categories/${hijaSlug}/tags`).expect(200);
    expect((res.body as TagRef[]).some((t) => t.id === delPadre.body.id)).toBe(true);
  });

  it('los PROPIOS salen ANTES que los heredados (orden de sugerencia)', async () => {
    const delPadre = await crearTag({ name: `B1 Padre orden ${Date.now()}` });
    const propio = await crearTag({ name: `B1 Propio orden ${Date.now()}` });

    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [delPadre.body.id] }).expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [propio.body.id] }).expect(200);

    const efectivos = (await request(app.getHttpServer())
      .get(`/api/categories/${hijaSlug}/tags`).expect(200)).body as TagRef[];

    const iPropio = efectivos.findIndex((t) => t.id === propio.body.id);
    const iHeredado = efectivos.findIndex((t) => t.id === delPadre.body.id);
    expect(iPropio).toBeGreaterThanOrEqual(0);
    expect(iHeredado).toBeGreaterThan(iPropio);
  });

  it('el mismo tag en padre e hija no se duplica', async () => {
    const compartido = await crearTag({ name: `B1 Compartido ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [compartido.body.id] }).expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [compartido.body.id] }).expect(200);

    const efectivos = (await request(app.getHttpServer())
      .get(`/api/categories/${hijaSlug}/tags`).expect(200)).body as TagRef[];
    expect(efectivos.filter((t) => t.id === compartido.body.id)).toHaveLength(1);
  });

  it('GET /categories/:slug incluye los tags efectivos (el wizard no necesita otro viaje)', async () => {
    const t = await crearTag({ name: `B1 En ficha ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [t.body.id] }).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/categories/${hijaSlug}`).expect(200);
    expect((res.body.tags as TagRef[]).some((x) => x.id === t.body.id)).toBe(true);
  });

  it('el seed trae el vocabulario base con su herencia (estado determinista para B2/B3/B4)', async () => {
    const deCoches = (await request(app.getHttpServer())
      .get('/api/categories/coches/tags').expect(200)).body as TagRef[];
    const slugs = deCoches.map((t) => t.slug);

    expect(slugs).toContain('unico-dueno');   // propio de coches
    expect(slugs).toContain('garantia');       // heredado de vehiculos
    expect(slugs).not.toContain('descatalogado'); // existe pero no está asignado
    // Y el propio va antes que el heredado.
    expect(slugs.indexOf('unico-dueno')).toBeLessThan(slugs.indexOf('garantia'));
  });

  // ── Asignación por categoría ────────────────────────────────────────────────

  it('GET /admin/categories/:id/tags separa propios de heredados', async () => {
    const delPadre = await crearTag({ name: `B1 Sep padre ${Date.now()}` });
    const propio = await crearTag({ name: `B1 Sep propio ${Date.now()}` });
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [delPadre.body.id] }).expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [propio.body.id] }).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/admin/categories/${hijaId}/tags`).set(admin()).expect(200);

    expect((res.body.own as TagRef[]).map((t) => t.id)).toEqual([propio.body.id]);
    expect((res.body.inherited as TagRef[]).map((t) => t.id)).toContain(delPadre.body.id);
  });

  it('PUT reemplaza el set PROPIO y NO toca los heredados', async () => {
    const delPadre = await crearTag({ name: `B1 Intacto ${Date.now()}` });
    const viejo = await crearTag({ name: `B1 Viejo ${Date.now()}` });
    const nuevo = await crearTag({ name: `B1 Nuevo ${Date.now()}` });

    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [delPadre.body.id] }).expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [viejo.body.id] }).expect(200);

    const res = await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [nuevo.body.id] }).expect(200);

    expect((res.body.own as TagRef[]).map((t) => t.id)).toEqual([nuevo.body.id]);
    // El del padre sigue llegando: PUT en la hija no lo toca.
    expect((res.body.inherited as TagRef[]).map((t) => t.id)).toContain(delPadre.body.id);
    expect(await prisma.categoryTag.count({ where: { categoryId: padreId, tagId: delPadre.body.id } })).toBe(1);
  });

  it('PUT con lista vacía deja la categoría sin tags propios', async () => {
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${hijaId}/tags`).set(admin())
      .send({ tagIds: [] }).expect(200);
    expect(await prisma.categoryTag.count({ where: { categoryId: hijaId } })).toBe(0);
  });

  it('PUT con un tag inexistente → 400', async () => {
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: ['no-existe'] }).expect(400);
  });

  // ── Frontera de rol ─────────────────────────────────────────────────────────

  it('ADMIN-only: un MODERATOR recibe 403 en todos los endpoints admin de tags', async () => {
    const mod = { Authorization: `Bearer ${moderatorToken}` };
    await request(app.getHttpServer()).get('/api/admin/tags').set(mod).expect(403);
    await request(app.getHttpServer()).post('/api/admin/tags').set(mod).send({ name: 'X' }).expect(403);
    await request(app.getHttpServer()).get(`/api/admin/categories/${padreId}/tags`).set(mod).expect(403);
    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(mod).send({ tagIds: [] }).expect(403);
  });

  it('sin token, 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/tags').expect(401);
  });

  it('el endpoint PÚBLICO de tags no pide sesión', async () => {
    await request(app.getHttpServer()).get(`/api/categories/${padreSlug}/tags`).expect(200);
  });

  it('una categoría inexistente da 404, no una lista vacía', async () => {
    await request(app.getHttpServer()).get('/api/categories/no-existe-b1/tags').expect(404);
  });

  // ── Setting ─────────────────────────────────────────────────────────────────

  it('maxTagsPerListing está en la whitelist de ajustes', async () => {
    // 404 ("no encontrado") y NO 400 ("clave no permitida") es la prueba de que la
    // clave está aceptada: la validación de whitelist corre ANTES de buscar la fila.
    //
    // El 404 es comportamiento PRE-EXISTENTE de PATCH /admin/settings/:key, que exige
    // que la fila exista (`findUnique` + NotFound, no un upsert). Afecta igual a
    // `supportEmail` y `ticketAutoCloseWindowDays`, que tampoco se siembran. Como el
    // diseño pide expresamente NO sembrar esta clave —"sin configurar" es un estado
    // válido que cae a DEFAULT_MAX_TAGS_PER_LISTING—, se deja así y se documenta.
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 8 });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/no permitida/);
  });

  it('maxTagsPerListing rechaza 0 — un tope de 0 mataría el sistema', async () => {
    // La validación de POSITIVE_INT corre antes que la búsqueda de la fila, así que
    // este 400 se ve aunque el ajuste no esté sembrado.
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 0 });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/mayor o igual a 1/);
  });

  it('una vez sembrada la fila, el ajuste se edita con normalidad', async () => {
    // Se crea la fila a mano para ejercer el camino completo sin sembrarla en el seed.
    await prisma.setting.upsert({
      where: { key: 'maxTagsPerListing' }, create: { key: 'maxTagsPerListing', value: 5 }, update: {},
    });

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 8 }).expect(200);
    expect(res.body.value).toBe(8);

    await prisma.setting.deleteMany({ where: { key: 'maxTagsPerListing' } });
  });

  // ── Caché ───────────────────────────────────────────────────────────────────

  it('la caché se INVALIDA al cambiar la asignación (no se sirve lo viejo)', async () => {
    const t = await crearTag({ name: `B1 Cache ${Date.now()}` });

    // Primera lectura: cachea el estado actual (sin el tag nuevo).
    const antes = (await request(app.getHttpServer())
      .get(`/api/categories/${padreSlug}/tags`).expect(200)).body as TagRef[];
    expect(antes.some((x) => x.id === t.body.id)).toBe(false);

    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [t.body.id] }).expect(200);

    // Si la caché no se invalidara, esto devolvería la lista de antes.
    const despues = (await request(app.getHttpServer())
      .get(`/api/categories/${padreSlug}/tags`).expect(200)).body as TagRef[];
    expect(despues.some((x) => x.id === t.body.id)).toBe(true);
  });

  it('cambiar los tags del padre invalida también la caché de la HIJA (los hereda)', async () => {
    const t = await crearTag({ name: `B1 Cache hija ${Date.now()}` });

    await request(app.getHttpServer()).get(`/api/categories/${hijaSlug}/tags`).expect(200);

    await request(app.getHttpServer())
      .put(`/api/admin/categories/${padreId}/tags`).set(admin())
      .send({ tagIds: [t.body.id] }).expect(200);

    const despues = (await request(app.getHttpServer())
      .get(`/api/categories/${hijaSlug}/tags`).expect(200)).body as TagRef[];
    expect(despues.some((x) => x.id === t.body.id)).toBe(true);
  });
});
