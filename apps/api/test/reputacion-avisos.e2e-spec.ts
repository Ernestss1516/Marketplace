import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ReviewsService } from 'src/modules/reviews/reviews.service';
import { ModerationService } from 'src/modules/moderation/moderation.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * NOTIFICACIONES N4a — LOS AVISOS DE REPUTACIÓN.
 *
 * ── LOS DOS HUECOS QUE CIERRA ───────────────────────────────────────────────
 *
 * 1. **Recibir una valoración no avisaba a nadie.** Era «el evento más notificable
 *    que quedaba sin cubrir» (§A3.6): alguien escribe públicamente sobre ti, queda
 *    en tu perfil y cuenta para tu media, y no te enterabas. El sistema sí avisaba
 *    de que PODÍAS valorar (`REVIEW_REQUEST`) — o sea, del lado sin consecuencias.
 *
 * 2. **Restaurar no avisaba, retirar sí.** Una asimetría injustificada, la misma
 *    que `restoreListing` ya corrigió en anuncios: «avisar solo de lo malo sería la
 *    mitad de la conversación».
 */
describe('Reputación — avisos de valoraciones (N4a) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let reviews: ReviewsService;
  let moderation: ModerationService;
  let addSpy: jest.SpyInstance;

  let autor: { id: string; name: string; slug: string };
  let valorado: { id: string; slug: string };
  let moderador: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    reviews = app.get(ReviewsService);
    moderation = app.get(ModerationService);

    // La cola QUE EL SERVICIO TIENE INYECTADA, no la del `app.get` global: varios
    // módulos registran la misma cola por nombre y cada registro crea su propia
    // instancia. Molde de `moderation-notifications.e2e-spec.ts`.
    const queue = (
      reviews as unknown as { notificationQueue: { add: (...a: unknown[]) => unknown } }
    ).notificationQueue;
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    addSpy.mockClear();
    autor = await crearUsuario('autor');
    valorado = await crearUsuario('valorado');
    moderador = (await crearUsuario('mod', 'MODERATOR')).id;
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  async function crearUsuario(prefijo: string, role: 'USER' | 'MODERATOR' = 'USER') {
    const id = randomUUID().slice(0, 8);
    const u = await prisma.user.create({
      data: {
        email: `rep-${prefijo}-${id}@test.local`,
        name: `Rep ${prefijo} ${id}`,
        slug: `rep-${prefijo}-${id}`,
        role,
      },
    });
    return { id: u.id, name: u.name, slug: u.slug };
  }

  /** Un anuncio del valorado + un trato cerrado con el autor: lo que habilita valorar. */
  async function anuncioConTrato() {
    const listing = await prisma.listing.create({
      data: {
        title: 'Bici de carretera',
        slug: `rep-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId: valorado.id,
        categoryId,
        status: 'ACTIVE',
      },
    });
    await prisma.deal.create({
      data: {
        listingId: listing.id,
        listingTitle: listing.title,
        sellerId: valorado.id,
        buyerId: autor.id,
      },
    });
    return listing;
  }

  const avisos = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type } });

  const correos = () =>
    addSpy.mock.calls
      .filter((c) => c[0] === NOTIFICATION_JOB.SEND_REVIEW_RECEIVED)
      .map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // BARRERA 1 — recibir una valoración avisa
  // ===========================================================================

  describe('recibir una valoración', () => {
    it('el VALORADO recibe el aviso, por los dos canales', async () => {
      const listing = await anuncioConTrato();

      await reviews.create(autor.id, {
        targetId: valorado.id,
        listingId: listing.id,
        rating: 5,
        comment: 'Todo perfecto',
      });

      const [aviso] = await avisos(valorado.id, 'REVIEW_RECEIVED');
      expect(aviso).toBeDefined();
      const data = aviso.data as Record<string, unknown>;
      expect(data.rating).toBe(5);
      // Nombre YA RESUELTO, nunca el id: el aviso se pinta sin consultas.
      expect(data.authorName).toBe(autor.name);
      expect(data.authorName).not.toBe(autor.id);
      expect(data.listingTitle).toBe('Bici de carretera');

      const [correo] = correos();
      expect(correo).toBeDefined();
      expect(correo.rating).toBe(5);
      // El enlace del correo va al perfil del VALORADO: es donde se lee.
      expect(correo.targetSlug).toBe(valorado.slug);
    });

    it('el AUTOR no recibe nada: no se avisa a nadie de su propia acción', async () => {
      const listing = await anuncioConTrato();

      await reviews.create(autor.id, {
        targetId: valorado.id,
        listingId: listing.id,
        rating: 4,
      });

      expect(await avisos(autor.id, 'REVIEW_RECEIVED')).toHaveLength(0);
    });

    /**
     * El aviso es EFECTO, nunca causa: si el `create` no llega a persistir, no se
     * avisa. Aquí se fuerza el P2002 de «ya has valorado a este usuario».
     */
    it('una valoración rechazada por duplicada no avisa', async () => {
      const listing = await anuncioConTrato();
      await reviews.create(autor.id, {
        targetId: valorado.id,
        listingId: listing.id,
        rating: 5,
      });
      addSpy.mockClear();

      await expect(
        reviews.create(autor.id, { targetId: valorado.id, listingId: listing.id, rating: 1 }),
      ).rejects.toThrow();

      // Sigue habiendo UNO: el de la primera. La segunda no añadió nada.
      expect(await avisos(valorado.id, 'REVIEW_RECEIVED')).toHaveLength(1);
      expect(correos()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // BARRERA 2 — la asimetría, cerrada
  // ===========================================================================

  describe('retirar y restaurar — las dos mitades de la conversación', () => {
    async function valoracionRetirada() {
      const review = await prisma.review.create({
        data: {
          rating: 2,
          authorId: autor.id,
          targetId: valorado.id,
          listingTitle: 'Mesa de roble',
        },
      });
      await moderation.retireReview(review.id, moderador, 'Contenido fuera de normas');
      return review;
    }

    it('retirar avisa al autor CON su motivo (N2, sostenido)', async () => {
      await valoracionRetirada();

      const [aviso] = await avisos(autor.id, 'REVIEW_MODERATED');
      const data = aviso.data as Record<string, unknown>;
      expect(data.action).toBe('RETIRED');
      expect(data.reason).toBe('Contenido fuera de normas');
    });

    /**
     * LA BARRERA DE N4a. Hasta aquí el autor sabía que se la habían retirado y
     * nunca que había vuelto — la mitad de la conversación.
     */
    it('restaurar TAMBIÉN avisa, con action RESTORED y sin motivo', async () => {
      const review = await valoracionRetirada();

      await moderation.restoreReview(review.id, moderador);

      const todos = await avisos(autor.id, 'REVIEW_MODERATED');
      const acciones = todos.map((n) => (n.data as Record<string, unknown>).action);
      expect(acciones).toContain('RESTORED');

      const restaurado = todos.find(
        (n) => (n.data as Record<string, unknown>).action === 'RESTORED',
      )!;
      // Deshacer no se justifica ante quien se beneficia.
      expect((restaurado.data as Record<string, unknown>).reason).toBeNull();

      // Y la valoración vuelve de verdad: el aviso no miente.
      const despues = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(despues.retiredAt).toBeNull();
    });

    /** A1, sostenido: editar no dice «retirada». */
    it('editar sigue siendo veraz: action EDITED, no RETIRED', async () => {
      const review = await prisma.review.create({
        data: { rating: 5, authorId: autor.id, targetId: valorado.id, comment: 'Original' },
      });

      await moderation.editReview(review.id, moderador, {
        comment: 'Recortado',
        reason: 'Dato personal',
      });

      const [aviso] = await avisos(autor.id, 'REVIEW_MODERATED');
      const data = aviso.data as Record<string, unknown>;
      expect(data.action).toBe('EDITED');
      expect(data.reason).toBe('Dato personal');

      // Sigue publicada: lo que el aviso afirma es verdad.
      const despues = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(despues.retiredAt).toBeNull();
    });
  });
});
