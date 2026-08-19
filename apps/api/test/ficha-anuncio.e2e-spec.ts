/**
 * FICHA F1 (P4) — EL DETALLE QUE ARREGLA LA MODERACIÓN A CIEGAS.
 *
 * LA BARRERA DE ESTA RÁFAGA, y conviene decir por qué es una barrera y no un
 * test más: hasta F1 el moderador **no podía ver lo que moderaba**. La cola de
 * revisión enlazaba a `/anuncio/{slug}`, la página pública, que lanza 404 para
 * todo lo que no sea ACTIVE; y la cola contiene, por construcción, sólo
 * PENDING_REVIEW. El enlace estaba roto el 100 % de las veces y no existe ninguna
 * vista previa de staff, así que se aprobaba y se rechazaba con el título, el
 * vendedor y la fecha. Nada más.
 *
 * El primer test de este fichero es exactamente esa frase: un moderador pide el
 * detalle de un PENDING_REVIEW y **recibe su descripción y sus fotos**.
 *
 * Ver docs/diseno-ficha-anuncio.md §0.1 y §5 (F1).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Ficha de anuncio F1 — el detalle del backoffice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerToken: string;
  let editorToken: string;
  let moderatorToken: string;
  let adminToken: string;
  let sellerId: string;
  let buyerId: string;
  let moderatorId: string;
  let categoryPadreId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  async function crearAnuncio(status: string, sufijo: string) {
    return prisma.listing.create({
      data: {
        title: `Ficha ${sufijo}`,
        slug: `ficha-${sufijo}-${Date.now()}`,
        description: `Descripción larga del anuncio ${sufijo}, la que el moderador no podía leer.`,
        price: 100,
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
    const [seller, buyer, , moderator] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'ficha-seller@example.com', name: 'Ficha Seller', slug: 'ficha-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'ficha-buyer@example.com', name: 'Ficha Buyer', slug: 'ficha-buyer',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'ficha-editor@example.com', name: 'Ficha Editor', slug: 'ficha-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ficha-mod@example.com', name: 'Ficha Mod', slug: 'ficha-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'ficha-admin@example.com', name: 'Ficha Admin', slug: 'ficha-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;
    buyerId = buyer.id;
    moderatorId = moderator.id;

    // Dos niveles, para que la RUTA de categoría tenga algo que enseñar.
    const padre = await prisma.category.create({
      data: { name: 'Ficha Padre', slug: 'ficha-padre', attributeSchema: [] },
    });
    categoryPadreId = padre.id;
    const hija = await prisma.category.create({
      data: {
        name: 'Ficha Hija', slug: 'ficha-hija', parentId: padre.id,
        attributeSchema: [
          { name: 'marca', label: 'Marca', type: 'text', filterable: true, required: false },
        ],
      },
    });
    categoryId = hija.id;

    const login = (email: string, ruta = '/api/auth/login') =>
      request(server()).post(ruta).send({ email, password: 'Test1234!' });

    sellerToken = (await login('ficha-seller@example.com')).body.accessToken as string;
    editorToken = (await login('ficha-editor@example.com', '/api/auth/admin-login')).body
      .accessToken as string;
    moderatorToken = (await login('ficha-mod@example.com', '/api/auth/admin-login')).body
      .accessToken as string;
    adminToken = (await login('ficha-admin@example.com', '/api/auth/admin-login')).body
      .accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── LA BARRERA ────────────────────────────────────────────────────────────

  describe('LA BARRERA — el moderador ve lo que modera', () => {
    it('un PENDING_REVIEW devuelve su DESCRIPCIÓN y sus FOTOS al moderador', async () => {
      // Éste es el test que da sentido a la ráfaga entera. Antes de F1 la única
      // forma de mirar un anuncio era `/anuncio/{slug}`, que para un
      // PENDING_REVIEW responde 404 — así que esto era imposible.
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'barrera');
      await prisma.listingImage.createMany({
        data: [
          { url: 'https://cdn.test/media/f1.jpg', listingId: anuncio.id, order: 0 },
          { url: 'https://cdn.test/media/f2.jpg', listingId: anuncio.id, order: 1 },
        ],
      });

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_REVIEW');
      expect(res.body.description).toContain('la que el moderador no podía leer');
      expect(res.body.images).toHaveLength(2);
      expect(res.body.images[0].url).toBe('https://cdn.test/media/f1.jpg');
      expect(Number(res.body.price)).toBe(100);
    });

    it('la página PÚBLICA sigue devolviendo 404 para ese mismo anuncio', async () => {
      // El contraste que explica por qué hacía falta la ficha. No se «arregla»
      // la pública: un PENDING_REVIEW NO debe ser visible fuera del backoffice.
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'publica-404');

      const res = await request(server()).get(`/api/listings/${anuncio.slug}`);

      expect(res.status).toBe(404);
    });

    it.each([['DRAFT'], ['REJECTED'], ['ARCHIVED'], ['PAUSED'], ['EXPIRED']])(
      'la ficha también sirve un %s (la pública no)',
      async (status) => {
        const anuncio = await crearAnuncio(status, `cualquiera-${status.toLowerCase()}`);

        const res = await request(server())
          .get(`/api/admin/listings/${anuncio.id}`)
          .set('Authorization', `Bearer ${moderatorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
        expect(res.body.description).toBeTruthy();
      },
    );
  });

  // ── Lo relacionado ────────────────────────────────────────────────────────

  describe('la ficha trae TODO lo relacionado', () => {
    it('valoraciones, tickets, tratos y recuentos', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'relacionado');

      await prisma.review.create({
        data: {
          rating: 4, comment: 'Buen trato', authorId: buyerId, targetId: sellerId,
          listingId: anuncio.id, listingTitle: anuncio.title,
        },
      });
      await prisma.ticket.create({
        data: {
          subject: 'Duda sobre el anuncio', origin: 'USER',
          userId: buyerId, openedById: buyerId, listingId: anuncio.id,
        },
      });
      await prisma.deal.create({
        data: {
          listingId: anuncio.id, listingTitle: anuncio.title,
          sellerId, buyerId,
        },
      });
      await prisma.favorite.create({ data: { userId: buyerId, listingId: anuncio.id } });

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0].rating).toBe(4);
      expect(res.body.reviews[0].author.id).toBe(buyerId);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0].subject).toBe('Duda sobre el anuncio');
      expect(res.body.deals).toHaveLength(1);
      expect(res.body.deals[0].buyer.id).toBe(buyerId);
      expect(res.body._count).toMatchObject({
        reviews: 1, tickets: 1, deals: 1, favorites: 1,
      });
    });

    it('la RUTA de la categoría, no sólo la hoja', async () => {
      // «Motor › Coches › Berlinas». Sin la cadena, el moderador no puede juzgar
      // si el anuncio está bien clasificado.
      const anuncio = await crearAnuncio('ACTIVE', 'ruta-categoria');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.categoryPath.map((c: { name: string }) => c.name)).toEqual([
        'Ficha Padre',
        'Ficha Hija',
      ]);
      expect(res.body.categoryPath[0].id).toBe(categoryPadreId);
    });

    it('la programación de bump, cuando la hay', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'bump');
      await prisma.bumpSchedule.create({
        data: {
          listingId: anuncio.id, userId: sellerId, intervalDays: 3, hourOfDay: 9,
          nextRunAt: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.bumpSchedule).toMatchObject({ intervalDays: 3, status: 'ACTIVE' });
    });

    it('404 si el anuncio no existe', async () => {
      const res = await request(server())
        .get('/api/admin/listings/no-existe')
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ── El historial ──────────────────────────────────────────────────────────

  describe('el historial — la primera LECTURA de la auditoría del proyecto', () => {
    it('tras aprobar, el historial muestra LISTING_APPROVE con su actor', async () => {
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'historial');
      await prisma.listingImage.create({
        data: { url: 'https://cdn.test/media/h1.jpg', listingId: anuncio.id, order: 0 },
      });

      await request(server())
        .post(`/api/moderation/listings/${anuncio.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      const acciones = res.body.historial.map((h: { action: string }) => h.action);
      expect(acciones).toContain('LISTING_APPROVE');
      const aprobado = res.body.historial.find(
        (h: { action: string }) => h.action === 'LISTING_APPROVE',
      );
      expect(aprobado.actor.id).toBe(moderatorId);
    });

    it('el historial NO expone la IP del actor', async () => {
      // Es el único campo del registro que no es historia del recurso sino
      // rastro de seguridad de la PERSONA. La ficha es MODERATOR; auditar
      // personas es otra pantalla con otro rol.
      // ACTIVE y no DRAFT: un borrador NO es archivable (`ARCHIVABLE_STATUSES`
      // no lo incluye), que es el callejón que B2 documentó y resolvió con
      // «descartar». Archivar desde ACTIVE sí es una transición legal.
      const anuncio = await crearAnuncio('ACTIVE', 'sin-ip');
      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'ARCHIVED' })
        .expect(200);

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.historial.length).toBeGreaterThan(0);
      for (const h of res.body.historial) {
        expect(h).not.toHaveProperty('ip');
      }
    });

    it('un anuncio sin movimientos trae el historial vacío, no falla', async () => {
      const anuncio = await crearAnuncio('DRAFT', 'sin-historial');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.historial).toEqual([]);
    });
  });

  // ── Las señales ───────────────────────────────────────────────────────────

  describe('las señales de moderación — las cuatro por separado', () => {
    afterEach(async () => {
      await prisma.user.update({ where: { id: sellerId }, data: { requiresReview: false } });
      await prisma.category.update({
        where: { id: categoryPadreId },
        data: { requiresReview: false },
      });
    });

    it('sin nada marcado, las cuatro señales van apagadas', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'senal-limpia');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.moderationSignals).toEqual({
        usuario: false, categoria: false, plataforma: false, palabraProhibida: false,
      });
    });

    it('vendedor marcado → sólo se enciende `usuario`', async () => {
      await prisma.user.update({ where: { id: sellerId }, data: { requiresReview: true } });
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'senal-usuario');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.moderationSignals.usuario).toBe(true);
      expect(res.body.moderationSignals.categoria).toBe(false);
    });

    it('categoría ANCESTRA marcada → se enciende `categoria` (herencia, no la hoja)', async () => {
      // La marca se pone en el PADRE y el anuncio cuelga de la hija: si las
      // señales miraran sólo la categoría directa, esto saldría apagado — que es
      // el fallo silencioso que M5 ya evitó en la decisión y que aquí se repite
      // porque reusa el MISMO pliegue.
      await prisma.category.update({
        where: { id: categoryPadreId },
        data: { requiresReview: true },
      });
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'senal-categoria');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.moderationSignals.categoria).toBe(true);
      expect(res.body.moderationSignals.usuario).toBe(false);
    });

    it('DOS niveles marcados → se encienden LOS DOS, no sólo el más específico', async () => {
      // La diferencia con `reviewTriggerFor`, que corta en el primero. Al
      // moderador le importa: desmarcar al vendedor no sacaría este anuncio de
      // la cola, porque la categoría sigue marcada.
      await prisma.user.update({ where: { id: sellerId }, data: { requiresReview: true } });
      await prisma.category.update({
        where: { id: categoryPadreId },
        data: { requiresReview: true },
      });
      const anuncio = await crearAnuncio('PENDING_REVIEW', 'senal-dos');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`);

      expect(res.body.moderationSignals.usuario).toBe(true);
      expect(res.body.moderationSignals.categoria).toBe(true);
    });
  });

  // ── Permisos (INV-1) ──────────────────────────────────────────────────────

  describe('permisos — la ficha es MODERATOR+', () => {
    it('un EDITOR recibe 403', async () => {
      // INV-1: la sección `anuncios` es MODERATOR en el mapa del frontal, y el
      // endpoint tiene que decir lo mismo. La relación sección↔endpoint es
      // muchos-a-muchos, así que no se puede derivar: se verifica aquí.
      const anuncio = await crearAnuncio('ACTIVE', 'perm-editor');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${editorToken}`);

      expect(res.status).toBe(403);
    });

    it('un usuario normal recibe 403', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'perm-user');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
    });

    it('sin token, 401', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'perm-anon');

      const res = await request(server()).get(`/api/admin/listings/${anuncio.id}`);

      expect(res.status).toBe(401);
    });

    it('un ADMIN también entra (la escalera, no un conjunto)', async () => {
      const anuncio = await crearAnuncio('ACTIVE', 'perm-admin');

      const res = await request(server())
        .get(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });
});
