/**
 * MENSAJERÍA C1 — el metadato de las conversaciones, para el staff.
 *
 * LA BARRERA QUE MANDA ES LA DEL `readAt`. El lector del usuario
 * (`MessagingService.getConversation`) **escribe**: marca como leídos los
 * mensajes del otro. Si el camino de staff se hubiera apoyado en él —que es lo
 * natural, «ya está hecho»—, un moderador mirando un hilo ajeno le habría dicho
 * al comprador que el vendedor había leído su mensaje: se alteraría el estado de
 * dos personas que no han hecho nada, en silencio, y mintiendo.
 *
 * Por eso el caso lee el `readAt` ANTES y DESPUÉS. No comprueba que el servicio
 * «esté bien escrito» — comprueba que MIRAR NO CAMBIA NADA, que es lo único que
 * un futuro refactor no puede romper sin enterarse.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Mensajería C1 — metadato para el staff (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let moderatorToken: string;
  let userToken: string;
  let vendedorId: string;
  let compradorId: string;
  let eliminadoId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  let n = 0;
  async function crearAnuncio(titulo: string) {
    return prisma.listing.create({
      data: {
        title: titulo,
        slug: `msg-${++n}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: vendedorId,
        categoryId,
      },
    });
  }

  /** Una conversación con `mensajes` mensajes del comprador, SIN leer. */
  async function crearHilo(opts: {
    listingId: string | null;
    listingTitle: string;
    buyerId: string;
    mensajes?: number;
  }) {
    const conv = await prisma.conversation.create({
      data: {
        listingId: opts.listingId,
        listingTitle: opts.listingTitle,
        buyerId: opts.buyerId,
        sellerId: vendedorId,
      },
    });
    for (let i = 0; i < (opts.mensajes ?? 1); i += 1) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          senderId: opts.buyerId,
          body: `Mensaje privado ${i} que el staff NO debe recibir`,
          // Sin `readAt`: es lo que la barrera 4 vigila.
        },
      });
    }
    return conv;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [vendedor, comprador, eliminado] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'msg-vendedor@example.com', name: 'MSG Vendedor', slug: 'msg-vendedor',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'msg-comprador@example.com', name: 'MSG Comprador', slug: 'msg-comprador',
          passwordHash, emailVerified: true,
        },
      }),
      // Una cuenta ELIMINADA: eliminar no borra la fila, la vacía. Su hilo tiene
      // que seguir contándose (barrera 1).
      prisma.user.create({
        data: {
          email: 'msg-eliminado@example.com', name: 'Usuario eliminado', slug: 'msg-eliminado',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'msg-mod@example.com', name: 'MSG Mod', slug: 'msg-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
    ]);
    vendedorId = vendedor.id;
    compradorId = comprador.id;
    eliminadoId = eliminado.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'MSG Cat', slug: 'msg-cat', attributeSchema: [] },
      })
    ).id;

    moderatorToken = (
      await request(server()).post('/api/auth/login').send({
        email: 'msg-mod@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
    userToken = (
      await request(server()).post('/api/auth/login').send({
        email: 'msg-comprador@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LA BARRERA 4 — mirar no cambia nada
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA: listar NO marca ningún mensaje como leído', async () => {
    const anuncio = await crearAnuncio('Con mensajes sin leer');
    const conv = await crearHilo({
      listingId: anuncio.id,
      listingTitle: anuncio.title,
      buyerId: compradorId,
      mensajes: 3,
    });

    const antes = await prisma.message.count({
      where: { conversationId: conv.id, readAt: null },
    });
    expect(antes).toBe(3);

    await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const despues = await prisma.message.count({
      where: { conversationId: conv.id, readAt: null },
    });
    // Los tres siguen sin leer. Si el camino de staff reutilizara
    // `getConversation`, aquí habría un 0 — y el comprador vería «leído» sin que
    // el vendedor hubiera abierto nada.
    expect(despues).toBe(3);
  });

  it('y tampoco toca `lastMessageAt` ni ningún otro campo del hilo', async () => {
    const anuncio = await crearAnuncio('Intacto tras mirarlo');
    const conv = await crearHilo({
      listingId: anuncio.id,
      listingTitle: anuncio.title,
      buyerId: compradorId,
    });
    const antes = await prisma.conversation.findUnique({ where: { id: conv.id } });

    await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const despues = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(despues).toEqual(antes);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // QUÉ SALE Y QUÉ NO
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA: el CUERPO de los mensajes no sale por esta puerta', async () => {
    const anuncio = await crearAnuncio('Sin cuerpo');
    await crearHilo({
      listingId: anuncio.id,
      listingTitle: anuncio.title,
      buyerId: compradorId,
      mensajes: 2,
    });

    const res = await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    // Se busca en la respuesta ENTERA serializada y no campo a campo: el cuerpo
    // podría colarse dentro de cualquier relación anidada que alguien añada
    // después. Molde del test del saldo de U3.
    expect(JSON.stringify(res.body)).not.toContain('Mensaje privado');
    // Y sí sale el metadato: cuántos hay.
    expect(res.body.items[0]._count.messages).toBe(2);
  });

  it('BARRERA 1: desde un anuncio se ven TODAS sus conversaciones, incluida la de una cuenta eliminada', async () => {
    const anuncio = await crearAnuncio('Con dos hilos');
    await crearHilo({ listingId: anuncio.id, listingTitle: anuncio.title, buyerId: compradorId });
    await crearHilo({ listingId: anuncio.id, listingTitle: anuncio.title, buyerId: eliminadoId });

    const res = await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(res.body.total).toBe(2);
    const compradores = (res.body.items as { buyer: { id: string } }[]).map((c) => c.buyer.id);
    expect(compradores).toContain(compradorId);
    // La de la cuenta eliminada NO se filtra: es «todas», y suele ser la que importa.
    expect(compradores).toContain(eliminadoId);
  });

  it('BARRERA 2: de un usuario salen sus DOS caras — como comprador y como vendedor', async () => {
    // El vendedor de todos los hilos de arriba es `vendedorId`; aquí además le
    // damos un hilo donde él es el COMPRADOR. Un `where` que sólo mirase una cara
    // se dejaría la mitad sin que nada fallara.
    const ajeno = await prisma.listing.create({
      data: {
        title: 'Anuncio de otro', slug: `msg-ajeno-${Date.now()}`, description: 'x', price: 5,
        type: 'PRODUCT', status: 'ACTIVE', sellerId: compradorId, categoryId,
      },
    });
    await prisma.conversation.create({
      data: {
        listingId: ajeno.id, listingTitle: ajeno.title,
        buyerId: vendedorId, sellerId: compradorId,
      },
    });

    const [comoComprador, comoVendedor, ambos] = await Promise.all([
      request(server())
        .get(`/api/admin/conversations?userId=${vendedorId}&papel=comprador`)
        .set('Authorization', `Bearer ${moderatorToken}`),
      request(server())
        .get(`/api/admin/conversations?userId=${vendedorId}&papel=vendedor`)
        .set('Authorization', `Bearer ${moderatorToken}`),
      request(server())
        .get(`/api/admin/conversations?userId=${vendedorId}`)
        .set('Authorization', `Bearer ${moderatorToken}`),
    ]);

    expect(comoComprador.body.total).toBe(1);
    expect(comoVendedor.body.total).toBeGreaterThan(0);
    // Y el defecto: sin papel salen LAS DOS, no una.
    expect(ambos.body.total).toBe(comoComprador.body.total + comoVendedor.body.total);
  });

  it('BARRERA 3: un hilo cuyo anuncio se borró sigue diciendo de qué iba', async () => {
    const anuncio = await crearAnuncio('Anuncio que se va');
    await crearHilo({
      listingId: anuncio.id,
      listingTitle: anuncio.title,
      buyerId: compradorId,
    });
    // El `SetNull` de `Conversation.listingId`: el hilo sobrevive al anuncio.
    await prisma.listing.delete({ where: { id: anuncio.id } });

    const res = await request(server())
      .get(`/api/admin/conversations?userId=${compradorId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const huerfana = (
      res.body.items as { listing: unknown; listingTitle: string }[]
    ).find((c) => c.listingTitle === 'Anuncio que se va');
    expect(huerfana).toBeDefined();
    // Sin relación… pero con el snapshot, que es lo que evita el guion.
    expect(huerfana!.listing).toBeNull();
    expect(huerfana!.listingTitle).toBe('Anuncio que se va');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PERMISOS Y FORMA
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 5: MODERATOR lista (200); un USER normal no (403)', async () => {
    const anuncio = await crearAnuncio('Permisos');

    await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}`)
      .expect(401);
  });

  it('BARRERA 8: no hay puerta de escritura — POST/PATCH/DELETE no existen', async () => {
    // El staff no escribe en conversaciones ajenas: para hablar con alguien está
    // el sistema de tickets, que además deja rastro.
    await request(server())
      .post('/api/admin/conversations')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ body: 'hola' })
      .expect(404);
  });

  it('sin filtro no sirve la mensajería entera de la plataforma: 400', async () => {
    await request(server())
      .get('/api/admin/conversations')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(400);
  });

  it('listingId y userId son excluyentes: 400', async () => {
    await request(server())
      .get(`/api/admin/conversations?listingId=x&userId=${compradorId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(400);
  });

  it('BARRERA 7: pagina de verdad — la segunda página trae hilos distintos', async () => {
    const anuncio = await crearAnuncio('Muchos hilos');
    // Cinco compradores distintos: `@@unique([listingId, buyerId])` impide cinco
    // hilos del mismo par sobre el mismo anuncio.
    for (let i = 0; i < 5; i += 1) {
      const u = await prisma.user.create({
        data: {
          email: `msg-pag-${i}-${Date.now()}@example.com`,
          name: `Pag ${i}`,
          slug: `msg-pag-${i}-${Date.now()}`,
          emailVerified: true,
        },
      });
      await crearHilo({ listingId: anuncio.id, listingTitle: anuncio.title, buyerId: u.id });
    }

    const p1 = await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}&perPage=2&page=1`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    const p2 = await request(server())
      .get(`/api/admin/conversations?listingId=${anuncio.id}&perPage=2&page=2`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(p1.body.total).toBe(5);
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.items).toHaveLength(2);
    const ids1 = (p1.body.items as { id: string }[]).map((c) => c.id);
    const ids2 = (p2.body.items as { id: string }[]).map((c) => c.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });
});
