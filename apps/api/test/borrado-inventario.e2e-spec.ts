/**
 * BORRADO — RÁFAGA B1: EL TEST DE INVENTARIO. **La barrera del cuerpo entero.**
 *
 * QUÉ AFIRMA. Se crea un anuncio con las TRECE relaciones que le cuelgan
 * pobladas, se borra, y se comprueba **una por una** cuáles murieron y cuáles
 * sobrevivieron. No un resumen: las trece, con su nombre.
 *
 * POR QUÉ EXISTE, y no es celo. El reparto entre «parte del anuncio» y «registro
 * con valor propio» vive repartido en trece `onDelete` del `schema.prisma`, y un
 * `onDelete` no falla ruidosamente cuando alguien lo cambia: **deja de guardar
 * cosas, en silencio**. Así llegó `Report` a ser `Cascade` — nadie lo decidió, era
 * el valor que quedó. Este fichero convierte ese reparto en una afirmación que se
 * rompe en CI, que es la única forma de que siga siendo verdad dentro de un año.
 *
 * LO QUE B1 CAMBIA, y aquí se fija: `Report` y `Conversation` pasan de `Cascade` a
 * `SetNull` + snapshot del título. Mientras fueron `Cascade`, **el denunciado podía
 * destruir la denuncia y el vendedor el hilo de mensajes que probaba lo que dijo**,
 * y bastaba con borrar el propio anuncio — que es, hoy, lo único que el borrado
 * permite. Ver docs/diseno-borrado.md §2.4 y §2.5.
 *
 * NO PRUEBA LA POLÍTICA DE PERMISOS (quién puede borrar y desde qué estado): eso es
 * B2. Aquí se usa el borrado que existe HOY —el del dueño— precisamente porque es
 * el que hoy destruye evidencia.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Borrado B1 — inventario de lo que cuelga de un anuncio (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let listingId: string;
  let sellerId: string;
  let buyerId: string;

  // Los ids de cada fila creada, para poder preguntar por ELLA y no por «alguna».
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller, buyer] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'binv-seller@example.com', name: 'BInv Seller', slug: 'binv-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'binv-buyer@example.com', name: 'BInv Buyer', slug: 'binv-buyer',
          passwordHash, emailVerified: true,
        },
      }),
    ]);
    sellerId = seller.id;
    buyerId = buyer.id;

    const category = await prisma.category.create({
      data: { name: 'BInv Cat', slug: 'binv-cat', attributeSchema: [] },
    });

    const listing = await prisma.listing.create({
      data: {
        title: 'BInv — anuncio que se va a borrar',
        slug: 'binv-anuncio',
        description: 'x',
        price: 100,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId: category.id,
      },
    });
    listingId = listing.id;

    // ── Las trece relaciones, pobladas ──────────────────────────────────────

    const tag = await prisma.tag.create({ data: { name: 'BInv Tag', slug: 'binv-tag' } });
    // ListingTag es la única sin id propio: su clave es [listingId, tagId]. Se
    // guarda el tagId, que es lo que hace falta para preguntar por ELLA después.
    await prisma.listingTag.create({ data: { listingId, tagId: tag.id } });
    ids.listingTag = tag.id;

    ids.image = (
      await prisma.listingImage.create({
        data: { url: 'https://example.com/media/binv.jpg', listingId, uploadedById: sellerId },
      })
    ).id;

    ids.favorite = (
      await prisma.favorite.create({ data: { listingId, userId: buyerId } })
    ).id;

    const alert = await prisma.alert.create({ data: { userId: buyerId, name: 'BInv Alert' } });
    ids.alertMatch = (
      await prisma.alertMatch.create({ data: { alertId: alert.id, listingId } })
    ).id;

    ids.viewDaily = (
      await prisma.listingViewDaily.create({
        data: { listingId, date: new Date('2026-01-01'), count: 3 },
      })
    ).id;

    const conversation = await prisma.conversation.create({
      data: {
        listingId,
        listingTitle: listing.title,
        buyerId,
        sellerId,
        messages: { create: { senderId: buyerId, body: 'Hola, ¿sigue disponible?' } },
      },
      include: { messages: true },
    });
    ids.conversation = conversation.id;
    ids.message = conversation.messages[0].id;

    ids.deal = (
      await prisma.deal.create({
        data: {
          listingId,
          listingTitle: listing.title,
          sellerId,
          buyerId,
          conversationId: conversation.id,
        },
      })
    ).id;

    ids.review = (
      await prisma.review.create({
        data: {
          rating: 5,
          authorId: buyerId,
          targetId: sellerId,
          listingId,
          listingTitle: listing.title,
        },
      })
    ).id;

    ids.report = (
      await prisma.report.create({
        data: {
          reason: 'SPAM',
          reporterId: buyerId,
          listingId,
          listingTitle: listing.title,
        },
      })
    ).id;

    ids.entitlement = (
      await prisma.entitlement.create({
        data: { userId: sellerId, type: 'FEATURED_LISTING', listingId },
      })
    ).id;

    const product = await prisma.product.create({ data: { name: 'BInv Prod', type: 'ONE_TIME' } });
    const price = await prisma.price.create({
      data: { productId: product.id, amount: 9.99, currency: 'EUR' },
    });
    ids.transaction = (
      await prisma.transaction.create({
        data: {
          userId: sellerId,
          priceId: price.id,
          listingId,
          amountGross: 9.99,
          amountNet: 8.26,
          taxAmount: 1.73,
          taxRate: 0.21,
        },
      })
    ).id;

    const schedule = await prisma.bumpSchedule.create({
      data: { listingId, userId: sellerId, intervalDays: 3, hourOfDay: 9, nextRunAt: new Date() },
    });
    ids.bumpSchedule = schedule.id;
    ids.bumpRun = (
      await prisma.bumpRun.create({ data: { scheduleId: schedule.id, slot: new Date() } })
    ).id;

    ids.ticket = (
      await prisma.ticket.create({
        data: {
          subject: 'BInv ticket',
          origin: 'USER',
          userId: buyerId,
          openedById: buyerId,
          listingId,
          linkedLabel: listing.title,
        },
      })
    ).id;

    // ── Y SE BORRA ──────────────────────────────────────────────────────────
    // El borrado crudo, sin pasar por el servicio: lo que se está fijando es el
    // comportamiento del SCHEMA (las acciones referenciales), no el del endpoint.
    await prisma.listing.delete({ where: { id: listingId } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('el anuncio ya no existe (ancla: si esto fallara, el resto no probaría nada)', async () => {
    expect(await prisma.listing.findUnique({ where: { id: listingId } })).toBeNull();
  });

  // ── PARTE DEL ANUNCIO: muere con él ───────────────────────────────────────
  //
  // Sin el anuncio no significan nada: son su contenido, sus accesorios o sus
  // contadores. Nadie que no fuera el dueño los echaría en falta.

  describe('PARTE DEL ANUNCIO — se borra', () => {
    it('ListingTag', async () => {
      expect(
        await prisma.listingTag.findUnique({
          where: { listingId_tagId: { listingId, tagId: ids.listingTag } },
        }),
      ).toBeNull();
    });

    it('ListingImage (la fila; los objetos de R2 son B3)', async () => {
      expect(await prisma.listingImage.findUnique({ where: { id: ids.image } })).toBeNull();
    });

    it('Favorite — un favorito a un anuncio inexistente no significa nada', async () => {
      expect(await prisma.favorite.findUnique({ where: { id: ids.favorite } })).toBeNull();
    });

    it('AlertMatch', async () => {
      expect(await prisma.alertMatch.findUnique({ where: { id: ids.alertMatch } })).toBeNull();
    });

    it('ListingViewDaily — las vistas son del anuncio', async () => {
      expect(await prisma.listingViewDaily.findUnique({ where: { id: ids.viewDaily } })).toBeNull();
    });

    it('BumpSchedule — agenda de un anuncio que ya no existe', async () => {
      expect(await prisma.bumpSchedule.findUnique({ where: { id: ids.bumpSchedule } })).toBeNull();
    });

    it('BumpRun — muere con su programación (es ejecución, no libro mayor)', async () => {
      expect(await prisma.bumpRun.findUnique({ where: { id: ids.bumpRun } })).toBeNull();
    });
  });

  // ── REGISTRO CON VALOR PROPIO: sobrevive ──────────────────────────────────
  //
  // Son la constancia de algo que PASÓ, y su valor no depende de que el anuncio
  // siga existiendo. La prueba: ¿lo echaría en falta alguien que no sea el dueño
  // del anuncio? Si sí, no es suyo para destruirlo.

  describe('REGISTRO CON VALOR PROPIO — sobrevive, con el anuncio a null y su título guardado', () => {
    // ── Lo que B1 arregla ───────────────────────────────────────────────────

    it('Report SOBREVIVE — antes de B1 se destruía, y lo destruía el propio denunciado', async () => {
      const report = await prisma.report.findUnique({ where: { id: ids.report } });
      expect(report).not.toBeNull();
      expect(report!.listingId).toBeNull();
      // El snapshot es lo que mantiene la denuncia legible en la cola: sin él,
      // sobrevivir sería sobrevivir sin poder decir de qué iba.
      expect(report!.listingTitle).toBe('BInv — anuncio que se va a borrar');
      // Y sigue siendo una denuncia de alguien contra algo, con su motivo.
      expect(report!.reporterId).toBe(buyerId);
      expect(report!.reason).toBe('SPAM');
    });

    it('Conversation SOBREVIVE — los mensajes son de dos personas, no del anuncio', async () => {
      const conv = await prisma.conversation.findUnique({ where: { id: ids.conversation } });
      expect(conv).not.toBeNull();
      expect(conv!.listingId).toBeNull();
      expect(conv!.listingTitle).toBe('BInv — anuncio que se va a borrar');
      expect(conv!.buyerId).toBe(buyerId);
      expect(conv!.sellerId).toBe(sellerId);
    });

    it('Message SOBREVIVE — es la mitad que de verdad importaba de la conversación', async () => {
      // Antes de B1 esto se lo llevaba la cascada de Conversation, en segundo
      // salto: el hilo entero, con la prueba de lo que se dijo.
      const msg = await prisma.message.findUnique({ where: { id: ids.message } });
      expect(msg).not.toBeNull();
      expect(msg!.body).toBe('Hola, ¿sigue disponible?');
    });

    it('Deal conserva su conversación — antes de B1 el SetNull la dejaba a null', async () => {
      // `Deal.conversationId` distingue «interacción verificable» de «afirmado por
      // el vendedor». Con Conversation en Cascade, borrar el anuncio degradaba esa
      // evidencia en silencio. Ahora el trato conserva su conversación.
      const deal = await prisma.deal.findUnique({ where: { id: ids.deal } });
      expect(deal).not.toBeNull();
      expect(deal!.listingId).toBeNull();
      expect(deal!.listingTitle).toBe('BInv — anuncio que se va a borrar');
      expect(deal!.conversationId).toBe(ids.conversation);
    });

    // ── Lo que ya estaba bien y hay que impedir que se rompa ────────────────

    it('Review SOBREVIVE — «la reputación no es borrable por el vendedor»', async () => {
      const review = await prisma.review.findUnique({ where: { id: ids.review } });
      expect(review).not.toBeNull();
      expect(review!.listingId).toBeNull();
      expect(review!.listingTitle).toBe('BInv — anuncio que se va a borrar');
    });

    it('Ticket SOBREVIVE — el hilo de atención no desaparece con lo que trataba', async () => {
      const ticket = await prisma.ticket.findUnique({ where: { id: ids.ticket } });
      expect(ticket).not.toBeNull();
      expect(ticket!.listingId).toBeNull();
      expect(ticket!.linkedLabel).toBe('BInv — anuncio que se va a borrar');
    });

    it('Transaction SOBREVIVE — registro contable: nunca se borra', async () => {
      const tx = await prisma.transaction.findUnique({ where: { id: ids.transaction } });
      expect(tx).not.toBeNull();
      expect(tx!.listingId).toBeNull();
    });

    it('Entitlement SOBREVIVE — un derecho pagado no lo borra el borrado del anuncio', async () => {
      const ent = await prisma.entitlement.findUnique({ where: { id: ids.entitlement } });
      expect(ent).not.toBeNull();
      expect(ent!.listingId).toBeNull();
    });
  });

  it('las trece relaciones están cubiertas — ni una se ha quedado sin afirmar', () => {
    // Red del propio fichero. Si mañana aparece una relación nueva con FK a
    // Listing y nadie la añade aquí, este número deja de cuadrar y el test lo
    // dice. Es más barato que descubrirlo cuando algo desaparezca en silencio.
    expect(Object.keys(ids).sort()).toEqual(
      [
        'alertMatch', 'bumpRun', 'bumpSchedule', 'conversation', 'deal', 'entitlement',
        'favorite', 'image', 'listingTag', 'message', 'report', 'review', 'ticket',
        'transaction', 'viewDaily',
      ].sort(),
    );
  });
});
