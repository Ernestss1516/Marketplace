/**
 * BORRADO — `Report.reviewId`: LA DENUNCIA SOBREVIVE A LA VALORACIÓN. **La barrera.**
 *
 * QUÉ AFIRMA. Se crea una denuncia sobre una valoración por el endpoint real, se hace
 * desaparecer la valoración —el borrado FÍSICO que hoy no existe, ejecutado aquí a
 * propósito para simular el que exista mañana— y se comprueba que la denuncia sigue ahí,
 * con `reviewId` a `null` y con su snapshot: **qué se dijo y quién lo dijo**.
 *
 * POR QUÉ EXISTE. Es la segunda arista del defecto que arregló B1. Allí una denuncia
 * moría con el ANUNCIO que señalaba (`Report.listingId` era `Cascade`); aquí moría con la
 * VALORACIÓN. B1 lo dejó anotado como «riesgo 5, fuera de alcance porque va de reseñas»
 * (docs/diseno-borrado.md §2.4 «ojo con el segundo salto», §6.2), y 7b lo **neutralizó
 * sin resolverlo**: retiró el único camino que borraba valoraciones en vivo, así que con
 * la fila siempre viva el `Cascade` no llegaba a dispararse. Pero la regla seguía escrita,
 * armada para el siguiente que añadiera una supresión real —purga RGPD, `deleteMany` de
 * mantenimiento, cascada de usuario—, que habría destruido denuncias sin enterarse.
 *
 * POR QUÉ EL BORRADO SE HACE A PELO. Porque ningún endpoint borra valoraciones, y ese es
 * justo el punto: lo que se fija es el comportamiento del SCHEMA (la acción referencial),
 * no el de un endpoint. `prisma.review.delete` es exactamente lo que haría esa purga
 * futura, y es la única forma de probar hoy una barrera que protege de mañana.
 *
 * Y EL SNAPSHOT SE TOMA AL CREAR, NO AL BORRAR (diseño §3.3): la primera prueba lo mide
 * con la valoración todavía viva. Si se escribiera en el borrado sería un camino que sólo
 * se ejecuta ahí —o sea, que sólo se prueba ahí— y no habría segunda oportunidad.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Borrado — la denuncia sobrevive al borrado de la valoración (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let authorId: string;
  let reporterToken: string;

  const server = () => app.getHttpServer();

  /** Una valoración del `author` al `seller`, con el comentario que se pida. */
  const crearValoracion = (comment: string | null, listingId?: string) =>
    prisma.review.create({
      data: {
        rating: 1,
        comment,
        authorId,
        targetId: sellerId,
        listingId: listingId ?? null,
      },
    });

  /** El endpoint real de denunciar, con el token de un usuario normal. */
  const denunciar = (body: Record<string, unknown>) =>
    request(server())
      .post('/api/moderation/reports')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send(body)
      .expect(201)
      .then((r) => r.body as { id: string });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller, author] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'brv-seller@example.com', name: 'BRv Seller', slug: 'brv-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'brv-author@example.com', name: 'BRv Autor De La Resena', slug: 'brv-author',
          passwordHash, emailVerified: true,
        },
      }),
    ]);
    sellerId = seller.id;
    authorId = author.id;

    // El denunciante es el propio vendedor valorado: es el caso real (a quien le duele
    // una reseña es a su destinatario), y basta con que sea un USER autenticado.
    reporterToken = await request(server())
      .post('/api/auth/login')
      .send({ email: 'brv-seller@example.com', password: 'Test1234!' })
      .then((r) => r.body.accessToken as string);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL SNAPSHOT SE TOMA AL CREAR
  // ───────────────────────────────────────────────────────────────────────────

  it('el snapshot se escribe AL CREAR la denuncia, con la valoración todavía viva', async () => {
    const review = await crearValoracion('Estafador, no le compréis nada');
    const { id } = await denunciar({ reason: 'FAKE_REVIEW', reviewId: review.id });

    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    // La valoración NO se ha tocado: el enlace sigue vivo...
    expect(report.reviewId).toBe(review.id);
    // ...y aun así el snapshot ya está escrito. Esto es lo que hace que el dato esté
    // cuando la valoración desaparezca, sin depender de que el borrado se acuerde.
    expect(report.reviewComment).toBe('Estafador, no le compréis nada');
    expect(report.reviewAuthorName).toBe('BRv Autor De La Resena');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LA BARRERA
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA: borrar la valoración deja la denuncia VIVA, con reviewId null y el snapshot intacto', async () => {
    const review = await crearValoracion('Comentario denunciado que se va a perder');
    const { id } = await denunciar({
      reason: 'FAKE_REVIEW',
      description: 'Es falsa, nunca me compró nada',
      reviewId: review.id,
    });

    // EL BORRADO FÍSICO que hoy no existe y mañana puede existir (RGPD, `deleteMany`,
    // cascada de usuario). Con `Cascade`, esta línea destruía la denuncia entera.
    await prisma.review.delete({ where: { id: review.id } });
    expect(await prisma.review.findUnique({ where: { id: review.id } })).toBeNull();

    const report = await prisma.report.findUnique({ where: { id } });
    expect(report).not.toBeNull();
    // El enlace se suelta, que es lo que hace `SetNull`...
    expect(report!.reviewId).toBeNull();
    // ...y el snapshot es lo que impide que sobrevivir sea sobrevivir vacío: el
    // moderador sigue sabiendo QUÉ se denunció y de QUIÉN era.
    expect(report!.reviewComment).toBe('Comentario denunciado que se va a perder');
    expect(report!.reviewAuthorName).toBe('BRv Autor De La Resena');
    // Y sigue siendo una denuncia de alguien, con su motivo y su estado.
    expect(report!.reporterId).toBe(sellerId);
    expect(report!.reason).toBe('FAKE_REVIEW');
    expect(report!.description).toBe('Es falsa, nunca me compró nada');
    expect(report!.status).toBe('PENDING');
  });

  it('la cola de moderación sigue devolviendo la denuncia huérfana, sin romperse', async () => {
    // `listReports` hace `include: { review: ... }`. Con la relación a null tiene que
    // seguir sirviendo la fila —la denuncia sin valoración es justo la que hay que
    // poder mirar—, no desaparecer de la cola ni reventar.
    const review = await crearValoracion('Reseña que desaparece de la cola');
    const { id } = await denunciar({ reason: 'FAKE_REVIEW', reviewId: review.id });
    await prisma.review.delete({ where: { id: review.id } });

    const moderator = await prisma.user.create({
      data: {
        email: 'brv-mod@example.com', name: 'BRv Mod', slug: 'brv-mod',
        passwordHash: await bcrypt.hash('Test1234!', 10),
        emailVerified: true, role: 'MODERATOR',
      },
    });
    const modToken = await request(server())
      .post('/api/auth/admin-login')
      .send({ email: moderator.email, password: 'Test1234!' })
      .then((r) => r.body.accessToken as string);

    const cola = await request(server())
      .get('/api/moderation/reports?status=PENDING')
      .set('Authorization', `Bearer ${modToken}`)
      .expect(200);

    const fila = (cola.body.items as Array<{ id: string; review: unknown; reviewComment: string | null }>)
      .find((r) => r.id === id);
    expect(fila).toBeDefined();
    expect(fila!.review).toBeNull();
    expect(fila!.reviewComment).toBe('Reseña que desaparece de la cola');
  });

  it('una valoración sin comentario (sólo estrellas) deja al menos el autor', async () => {
    // `Review.comment` es opcional: el snapshot del texto puede ser null legítimamente,
    // y eso no puede llevarse por delante el resto.
    const review = await crearValoracion(null);
    const { id } = await denunciar({ reason: 'FAKE_REVIEW', reviewId: review.id });
    await prisma.review.delete({ where: { id: review.id } });

    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(report.reviewId).toBeNull();
    expect(report.reviewComment).toBeNull();
    expect(report.reviewAuthorName).toBe('BRv Autor De La Resena');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL BACKFILL
  // ───────────────────────────────────────────────────────────────────────────

  it('el backfill de la migración rellena las denuncias anteriores', async () => {
    // Una denuncia «de antes de la migración»: apunta a una valoración viva y tiene las
    // columnas de snapshot vacías, que es exactamente como quedaron las filas que ya
    // existían cuando se añadieron. Sin backfill se quedarían así para siempre y
    // perderían el contexto en cuanto su valoración desapareciera.
    const review = await crearValoracion('Reseña anterior a la migración');
    const antigua = await prisma.report.create({
      data: { reason: 'FAKE_REVIEW', reporterId: sellerId, reviewId: review.id },
    });
    expect(antigua.reviewComment).toBeNull();
    expect(antigua.reviewAuthorName).toBeNull();

    // El UPDATE es el de la migración, palabra por palabra
    // (20260822230000_report_sobrevive_borrado_valoracion). Copiarlo aquí es lo que
    // convierte el backfill en algo comprobado y no en SQL que se ejecutó una vez.
    await prisma.$executeRawUnsafe(`
      UPDATE "Report" r
         SET "reviewComment"    = v."comment",
             "reviewAuthorName" = a."name"
        FROM "Review" v
        JOIN "User" a ON a."id" = v."authorId"
       WHERE r."reviewId" = v."id"
         AND r."reviewAuthorName" IS NULL
    `);

    const rellenada = await prisma.report.findUniqueOrThrow({ where: { id: antigua.id } });
    expect(rellenada.reviewComment).toBe('Reseña anterior a la migración');
    expect(rellenada.reviewAuthorName).toBe('BRv Autor De La Resena');

    // Y ahora sí sobrevive con sentido, como las nuevas.
    await prisma.review.delete({ where: { id: review.id } });
    const despues = await prisma.report.findUniqueOrThrow({ where: { id: antigua.id } });
    expect(despues.reviewId).toBeNull();
    expect(despues.reviewComment).toBe('Reseña anterior a la migración');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LO DE B1, INTACTO
  // ───────────────────────────────────────────────────────────────────────────

  it('la denuncia sobre un ANUNCIO sigue como la dejó B1 — esto sólo AÑADE la arista de la reseña', async () => {
    const category = await prisma.category.create({
      data: { name: 'BRv Cat', slug: 'brv-cat', attributeSchema: [] },
    });
    const listing = await prisma.listing.create({
      data: {
        title: 'BRv — anuncio denunciado',
        slug: 'brv-anuncio',
        description: 'x',
        price: 100,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId: category.id,
      },
    });

    const { id } = await denunciar({ reason: 'SPAM', listingId: listing.id });
    const alCrear = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(alCrear.listingTitle).toBe('BRv — anuncio denunciado');
    // Una denuncia de anuncio no inventa snapshot de reseña.
    expect(alCrear.reviewComment).toBeNull();
    expect(alCrear.reviewAuthorName).toBeNull();

    await prisma.listing.delete({ where: { id: listing.id } });
    const report = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(report.listingId).toBeNull();
    expect(report.listingTitle).toBe('BRv — anuncio denunciado');
  });
});
