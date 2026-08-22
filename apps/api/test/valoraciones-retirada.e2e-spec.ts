/**
 * VALORACIONES 7b — RETIRADA LÓGICA. Tres barreras.
 *
 *  1. **Retirar la saca del PÚBLICO por completo, y sin dejar hueco.** No sólo del perfil:
 *     también de la estrella que pinta la ficha del anuncio, que sale de otro método
 *     (`getRatingSummaries`) setenta líneas más abajo y de otro fichero de consumo. Se
 *     miden las DOS superficies en la misma prueba porque el fallo real no es «se me
 *     olvidó filtrar», es «filtré en el sitio que estaba mirando»: el perfil diría 5,0 y
 *     la tarjeta del mismo vendedor seguiría diciendo 3,0. Dos verdades sobre la misma
 *     reputación, y ninguna pantalla que las enfrente.
 *
 *  2. **La denuncia SOBREVIVE a la retirada, y el flujo entero de la cola termina.** Es la
 *     barrera que fija el fuego que 7b apaga: `Report.reviewId` es `Cascade`, así que el
 *     borrado físico se llevaba por delante la denuncia que lo motivaba, y el
 *     `resolveReport` que venía justo detrás respondía 404. Se mide el flujo COMPLETO
 *     —retirar y luego resolver—, no sólo que la fila siga ahí: con sólo lo segundo, el
 *     404 del segundo paso seguiría pasando desapercibido.
 *
 *  3. **Editar de staff no se disfraza de edición del autor.** `editedAt` significa «el
 *     autor la editó» y el frontal pinta «Editada» con él; `verified` está congelado al
 *     crear. Un moderador que corrige un comentario no puede mover ninguno de los dos sin
 *     mentirle al lector sobre quién escribió lo que está leyendo. Mismo cuidado que P1
 *     tuvo con `EDITED`.
 *
 * Ver `docs/diseno-valoraciones-mod.md`.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Valoraciones 7b — retirada lógica (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let buyerId: string;
  let moderatorId: string;
  let categoryId: string;
  let listingId: string;
  let listingSlug: string;
  let buyerToken: string;
  let moderatorToken: string;

  const server = () => app.getHttpServer();

  const perfil = () =>
    request(server()).get('/api/users/v7b-seller/reviews').expect(200).then((r) => r.body);

  const fichaPublica = () =>
    request(server()).get(`/api/listings/${listingSlug}`).expect(200).then((r) => r.body);

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller, buyer, moderator] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'v7b-seller@example.com', name: 'V7B Seller', slug: 'v7b-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'v7b-buyer@example.com', name: 'V7B Buyer', slug: 'v7b-buyer',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'v7b-mod@example.com', name: 'V7B Mod', slug: 'v7b-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
    ]);
    sellerId = seller.id;
    buyerId = buyer.id;
    moderatorId = moderator.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'V7B Cat', slug: 'v7b-cat', attributeSchema: [] },
      })
    ).id;

    listingSlug = `v7b-anuncio-${Date.now()}`;
    listingId = (
      await prisma.listing.create({
        data: {
          title: 'Anuncio de las valoraciones',
          slug: listingSlug,
          description: 'El anuncio sobre el que se valora al vendedor.',
          price: 100,
          type: 'PRODUCT',
          status: 'ACTIVE',
          sellerId,
          categoryId,
        },
      })
    ).id;

    [buyerToken, moderatorToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'v7b-buyer@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'v7b-mod@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — desaparece del público entero, sin hueco
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: retirar la borra del perfil Y de la estrella de la ficha, y sin dejar hueco', async () => {
    // Dos valoraciones verificadas: 5★ y 1★ → media 3,0 con las dos.
    const [buena, mala] = await Promise.all([
      prisma.review.create({
        data: {
          rating: 5, comment: 'Trato impecable', verified: true,
          authorId: buyerId, targetId: sellerId, listingId,
          listingTitle: 'Anuncio de las valoraciones',
        },
      }),
      prisma.review.create({
        data: {
          rating: 1, comment: 'Insultos varios', verified: true,
          authorId: moderatorId, targetId: sellerId,
          listingTitle: 'Anuncio de las valoraciones',
        },
      }),
    ]);

    // Punto de partida: las dos superficies dicen lo mismo.
    const antesPerfil = await perfil();
    expect(antesPerfil.count).toBe(2);
    expect(antesPerfil.average).toBe(3);
    expect(antesPerfil.items).toHaveLength(2);
    expect((await fichaPublica()).seller.ratingAverage).toBe(3);

    await request(server())
      .post(`/api/moderation/reviews/${mala.id}/retire`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Insultos, no describe ningún trato' })
      .expect(200);

    // El perfil: ni en la media, ni en el conteo, ni en la lista. «Sin hueco» es esto:
    // `items` tiene UNA fila, no dos con una en blanco ni un placeholder de retirada.
    const perfilDespues = await perfil();
    expect(perfilDespues.count).toBe(1);
    expect(perfilDespues.average).toBe(5);
    expect(perfilDespues.items).toHaveLength(1);
    expect(perfilDespues.items[0].id).toBe(buena.id);
    expect(perfilDespues.distribution['1']).toBe(0);

    // LA MITAD QUE SE OLVIDA: la estrella de la ficha pública sale de
    // `getRatingSummaries`, no de `listForUser`. Si sólo se filtrara arriba, esta
    // aserción seguiría viendo la retirada y el vendedor tendría dos reputaciones.
    const ficha = await fichaPublica();
    expect(ficha.seller.ratingAverage).toBe(5);
    expect(ficha.seller.ratingCount).toBe(1);

    // Y el staff SÍ la sigue viendo, marcada: retirar no es esconderle la valoración a
    // quien tiene que poder restaurarla.
    const staff = await request(server())
      .get(`/api/admin/users/${sellerId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    const vistaStaff = staff.body.reviewsReceived as Array<{ id: string; retiredAt: string | null }>;
    expect(vistaStaff).toHaveLength(2);
    expect(vistaStaff.find((v) => v.id === mala.id)?.retiredAt).toBeTruthy();
  });

  it('BARRERA 1 (vuelta): restaurar la devuelve entera a las dos superficies', async () => {
    const retirada = await prisma.review.findFirstOrThrow({
      where: { targetId: sellerId, retiredAt: { not: null } },
    });

    await request(server())
      .post(`/api/moderation/reviews/${retirada.id}/restore`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const despues = await perfil();
    expect(despues.count).toBe(2);
    expect(despues.average).toBe(3);
    expect((await fichaPublica()).seller.ratingAverage).toBe(3);

    // Se deja retirada otra vez para no condicionar a las barreras siguientes.
    await request(server())
      .post(`/api/moderation/reviews/${retirada.id}/retire`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Insultos, no describe ningún trato' })
      .expect(200);
  });

  it('BARRERA 1 (el candado): retirada NO libera el hueco — su autor no puede escribir otra', async () => {
    // La valoración retirada sigue ocupando su `@@unique([authorId, targetId, listingId])`.
    // Decirle al autor que puede volver a valorar sería mentirle —el `create` reventaría
    // con un P2002— y además invitaría a repetir lo que se acaba de retirar.
    const conversation = await prisma.conversation.create({
      data: {
        listingId, buyerId, sellerId, lastMessageAt: new Date(),
        messages: { create: { senderId: buyerId, body: '¿Sigue disponible?' } },
      },
    });
    await prisma.deal.create({
      data: {
        listingId, listingTitle: 'Anuncio de las valoraciones',
        sellerId, buyerId, conversationId: conversation.id,
      },
    });
    // La 5★ del comprador sobre este anuncio existe y está vigente; se retira para medir
    // la elegibilidad del propio autor sobre una valoración RETIRADA.
    const suya = await prisma.review.findFirstOrThrow({
      where: { authorId: buyerId, targetId: sellerId, listingId },
    });
    await request(server())
      .post(`/api/moderation/reviews/${suya.id}/retire`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Se retira para medir el candado' })
      .expect(200);

    const res = await request(server())
      .get(`/api/reviews/eligibility?listingId=${listingId}&targetId=${sellerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body.alreadyReviewed).toBe(true);
    expect(res.body.canReview).toBe(false);

    await request(server())
      .post(`/api/moderation/reviews/${suya.id}/restore`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — la denuncia sobrevive, y el flujo de la cola TERMINA
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2: retirar desde la cola de denuncias → la denuncia sobrevive y se resuelve sin 404', async () => {
    const review = await prisma.review.create({
      data: {
        rating: 1, comment: 'Valoración denunciada', verified: true,
        authorId: buyerId, targetId: moderatorId,
        listingTitle: 'Anuncio de las valoraciones',
      },
    });
    const reporte = await prisma.report.create({
      data: { reason: 'FAKE_REVIEW', reporterId: moderatorId, reviewId: review.id },
    });

    // EL FLUJO EXACTO DEL BOTÓN de `/admin/reportes`, en su orden: primero la acción
    // sobre el contenido, después resolver la denuncia. Con el borrado físico, el
    // `Cascade` de `Report.reviewId` mataba el reporte en el primer paso y el segundo
    // respondía 404 — roto el 100 % de las veces.
    await request(server())
      .post(`/api/moderation/reviews/${review.id}/retire`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: `Retirada por denuncia ${reporte.id}` })
      .expect(200);

    const sobrevive = await prisma.report.findUnique({ where: { id: reporte.id } });
    expect(sobrevive).not.toBeNull();
    expect(sobrevive!.reviewId).toBe(review.id);

    await request(server())
      .patch(`/api/moderation/reports/${reporte.id}/resolve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    const resuelto = await prisma.report.findUniqueOrThrow({ where: { id: reporte.id } });
    expect(resuelto.status).toBe('RESOLVED');

    // Y la cola sigue pudiendo enseñar de qué iba la denuncia: la valoración está ahí,
    // marcada. Con el borrado, este panel se quedaba sin contenido que mostrar.
    const cola = await request(server())
      .get('/api/moderation/reports?status=RESOLVED')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    const fila = (cola.body.items as Array<{ id: string; review: { retiredAt: string | null } | null }>)
      .find((r) => r.id === reporte.id);
    expect(fila?.review?.retiredAt).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — editar de staff no se disfraza de edición del autor
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: el staff edita → cambia el contenido, NO toca editedAt ni verified', async () => {
    const review = await prisma.review.create({
      data: {
        rating: 2, comment: 'Buen trato, pero su móvil es 600123456', verified: true,
        authorId: buyerId, targetId: moderatorId,
        listingTitle: 'Anuncio de las valoraciones',
      },
    });
    expect(review.editedAt).toBeNull();

    await request(server())
      .patch(`/api/moderation/reviews/${review.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        rating: 3,
        comment: 'Buen trato.',
        reason: 'Se retira un dato personal del comentario',
      })
      .expect(200);

    const despues = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(despues.rating).toBe(3);
    expect(despues.comment).toBe('Buen trato.');
    // LAS DOS QUE NO SE MUEVEN. `editedAt` afirma «el AUTOR la editó» —el frontal pinta
    // «Editada» con él— y `verified` está congelado al crear. Escribir cualquiera de los
    // dos aquí sería que el equipo firme como si fuera el autor.
    expect(despues.editedAt).toBeNull();
    expect(despues.verified).toBe(true);

    // Lo que sí queda: el rastro, con el motivo, a nombre de quien lo hizo.
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: review.id, action: 'REVIEW_EDIT' },
    });
    expect(log.actorId).toBe(moderatorId);
    expect((log.before as { rating: number }).rating).toBe(2);
    expect((log.after as { reason: string }).reason).toBe(
      'Se retira un dato personal del comentario',
    );
  });

  it('editar sin motivo → 400 (el motivo es el freno, no hay confirmación aparte)', async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { targetId: moderatorId } });

    await request(server())
      .patch(`/api/moderation/reviews/${review.id}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ comment: 'Cambio sin justificar' })
      .expect(400);
  });

  it('retirar una ya retirada → 400 (no se apila el motivo ni se pisa quién la retiró)', async () => {
    const retirada = await prisma.review.findFirstOrThrow({
      where: { retiredAt: { not: null } },
    });

    await request(server())
      .post(`/api/moderation/reviews/${retirada.id}/retire`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Segundo intento sobre la misma' })
      .expect(400);
  });
});
