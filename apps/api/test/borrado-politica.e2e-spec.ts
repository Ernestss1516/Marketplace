/**
 * BORRADO — RÁFAGA B2: LA POLÍTICA DE PERMISOS.
 *
 * QUIÉN PUEDE DESTRUIR UN ANUNCIO, Y DESDE DÓNDE. Hasta B2 la respuesta estaba al
 * revés de lo que debía: **borraba el DUEÑO, desde cualquier estado, y el staff no
 * podía**. Con B1 eso ya no destruía denuncias ni conversaciones; B2 cierra la
 * puerta entera:
 *
 *   · el dueño ARCHIVA (irreversible, no destructivo) y sólo puede DESCARTAR un
 *     borrador — algo que nunca existió para nadie más;
 *   · el staff ELIMINA, y sólo un ARCHIVED.
 *
 * LOS DOS PASOS SON LA SALVAGUARDA: para destruir un anuncio vivo hay que
 * archivarlo primero. Eso separa «sacarlo del mercado» de «destruirlo» y obliga a
 * decidir las dos cosas por separado.
 *
 * Ver docs/diseno-borrado.md §1.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Borrado B2 — la política de permisos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerToken: string;
  let moderatorToken: string;
  let adminToken: string;
  let sellerId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  /** Un anuncio del vendedor en el estado pedido. */
  async function crearAnuncio(status: string, sufijo: string) {
    return prisma.listing.create({
      data: {
        title: `BPol ${sufijo}`,
        slug: `bpol-${sufijo}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: status as never,
        sellerId,
        categoryId,
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'bpol-seller@example.com', name: 'BPol Seller', slug: 'bpol-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'bpol-mod@example.com', name: 'BPol Mod', slug: 'bpol-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'bpol-admin@example.com', name: 'BPol Admin', slug: 'bpol-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    const category = await prisma.category.create({
      data: { name: 'BPol Cat', slug: 'bpol-cat', attributeSchema: [] },
    });
    categoryId = category.id;

    const login = (email: string, ruta = '/api/auth/login') =>
      request(server()).post(ruta).send({ email, password: 'Test1234!' });

    sellerToken = (await login('bpol-seller@example.com')).body.accessToken as string;
    moderatorToken = (await login('bpol-mod@example.com')).body.accessToken as string;
    adminToken = (await login('bpol-admin@example.com', '/api/auth/admin-login')).body
      .accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── El dueño ──────────────────────────────────────────────────────────────

  describe('el dueño ya NO elimina anuncios', () => {
    it.each([['ACTIVE'], ['PAUSED'], ['SOLD'], ['EXPIRED'], ['REJECTED'], ['ARCHIVED']])(
      'un anuncio %s no se puede borrar por DELETE /listings/:id → 400',
      async (status) => {
        const anuncio = await crearAnuncio(status, `nodel-${status.toLowerCase()}`);

        const res = await request(server())
          .delete(`/api/listings/${anuncio.id}`)
          .set('Authorization', `Bearer ${sellerToken}`);

        expect(res.status).toBe(400);
        // El mensaje DICE LA SALIDA: un 400 mudo dejaría al vendedor sin saber
        // qué hacer con un anuncio que ya no quiere.
        expect(res.body.message).toMatch(/archiv/i);

        // Y no se ha ido nada por delante.
        expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
      },
    );

    it('un DRAFT sí se puede DESCARTAR → 204, y desaparece', async () => {
      // La salida que la política necesita: un DRAFT cuenta para el tope total y
      // NO es archivable, así que sin esto quedaría atrapado ocupando cupo.
      const anuncio = await crearAnuncio('DRAFT', 'descartable');

      await request(server())
        .delete(`/api/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(204);

      expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).toBeNull();
    });

    it('un PENDING_REVIEW NO se descarta: hay un moderador con trabajo encolado', async () => {
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'en-revision');

      await request(server())
        .delete(`/api/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(400);

      expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
    });

    it('descartar el borrador de OTRO sigue siendo 403, no 400', async () => {
      // La comprobación de propiedad va ANTES que la de estado: a un extraño no se
      // le dice en qué estado está un anuncio que no es suyo.
      const anuncio = await crearAnuncio('DRAFT', 'ajeno');
      const otroToken = (
        await request(server()).post('/api/auth/login').send({
          email: 'bpol-mod@example.com',
          password: 'Test1234!',
        })
      ).body.accessToken as string;

      await request(server())
        .delete(`/api/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${otroToken}`)
        .expect(403);
    });
  });

  // ── El staff ──────────────────────────────────────────────────────────────

  describe('el staff elimina, y sólo archivados', () => {
    it('ADMIN elimina un ARCHIVED → 204, y deja registro en AuditLog', async () => {
      const anuncio = await crearAnuncio('ARCHIVED', 'borrable');

      await request(server())
        .delete(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).toBeNull();

      // El registro es lo ÚNICO que sobrevive al anuncio: tiene que permitir
      // responder «¿qué era esto y de quién?» cuando la fila ya no está.
      const log = await prisma.auditLog.findFirst({
        where: { action: 'LISTING_DELETE', resourceId: anuncio.id },
      });
      expect(log).not.toBeNull();
      const before = log!.before as { title: string; sellerId: string; status: string };
      expect(before.title).toBe(anuncio.title);
      expect(before.sellerId).toBe(sellerId);
      expect(before.status).toBe('ARCHIVED');
    });

    it.each([['ACTIVE'], ['DRAFT'], ['PAUSED'], ['SOLD'], ['EXPIRED'], ['REJECTED']])(
      'un %s NO se puede eliminar sin archivar antes → 400',
      async (status) => {
        const anuncio = await crearAnuncio(status, `staff-${status.toLowerCase()}`);

        const res = await request(server())
          .delete(`/api/admin/listings/${anuncio.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/archiv/i);
        expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
      },
    );

    it('un MODERATOR NO puede eliminar (es la única acción irreversible: ADMIN-only)', async () => {
      const anuncio = await crearAnuncio('ARCHIVED', 'mod-no-puede');

      await request(server())
        .delete(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);

      expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
    });

    it('un usuario corriente tampoco, aunque sea el dueño', async () => {
      const anuncio = await crearAnuncio('ARCHIVED', 'dueno-no-puede');

      await request(server())
        .delete(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);

      expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
    });

    it('sin sesión → 401', async () => {
      const anuncio = await crearAnuncio('ARCHIVED', 'sin-sesion');
      await request(server()).delete(`/api/admin/listings/${anuncio.id}`).expect(401);
    });

    it('un anuncio inexistente → 404', async () => {
      await request(server())
        .delete('/api/admin/listings/no-existe-xyz')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ── El camino completo ────────────────────────────────────────────────────

  it('el camino de los DOS PASOS: el staff archiva y sólo entonces puede eliminar', async () => {
    // Es la política entera en un caso: nada vivo se destruye de un clic.
    const anuncio = await crearAnuncio('ACTIVE', 'dos-pasos');

    // Paso 0 — todavía no.
    await request(server())
      .delete(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    // Paso 1 — archivar, por el endpoint de estado que ya existía. La transición
    // ACTIVE→ARCHIVED siempre fue legal; lo que no había era quien la ofreciera.
    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    // Paso 2 — ahora sí.
    await request(server())
      .delete(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).toBeNull();
  });

  it('ARCHIVED sigue siendo terminal: eliminar no abre una puerta de vuelta', async () => {
    // La máquina de estados de la ráfaga (A) no se toca en B2. Eliminar NO es una
    // transición —destruye la fila—, así que no puede haberla relajado.
    const anuncio = await crearAnuncio('ARCHIVED', 'terminal');

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(400);
  });
});
