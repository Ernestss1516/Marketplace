import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ModerationService } from 'src/modules/moderation/moderation.service';
import { ModerationNotificationsService } from 'src/modules/moderation/moderation-notifications.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * AVISOS DE MODERACIÓN (§14.5) — los dos huecos que destapó la auditoría inicial
 * del sistema de atención al usuario y que no eran de tickets.
 *
 * Hasta esta ráfaga **ninguna acción de moderación avisaba a nadie**: al
 * denunciante no se le decía en qué acabó su denuncia, y a un vendedor le
 * retiraban el anuncio del marketplace sin una palabra — simplemente desaparecía.
 *
 * Suite NUEVA a propósito: `moderation.e2e-spec.ts` (45 casos, incluidos dos de
 * no-escalada de privilegios) **no se toca**. Lo que aquí se prueba son los
 * EFECTOS añadidos; que la lógica de moderación siga intacta lo demuestra que
 * aquella siga verde sin editarla.
 */
describe('Moderación — avisos al denunciante y al vendedor (§14.5) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let moderation: ModerationService;
  let addSpy: jest.SpyInstance;

  let denunciante: string;
  let vendedor: string;
  let moderador: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    moderation = app.get(ModerationService);
    // Se espía la cola QUE EL SERVICIO TIENE INYECTADA, no la que devuelve
    // `app.get(getQueueToken(...))`: varios módulos (contact, tickets y ahora
    // moderation) registran la misma cola por nombre y cada registro crea su
    // propia instancia de Queue, así que el `app.get` global devuelve la primera
    // que encuentra — que aquí NO es la de moderation. Con la instancia
    // equivocada el espía no ve nada y, peor, los asserts en negativo
    // ("no se manda email") pasarían vacíos sin probar nada.
    const queue = (
      app.get(ModerationNotificationsService) as unknown as {
        queue: { add: (...a: unknown[]) => unknown };
      }
    ).queue;
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
    denunciante = (await createUser('USER')).id;
    vendedor = (await createUser('USER')).id;
    moderador = (await createUser('MODERATOR')).id;
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `mn-${id}@test.local`, name: `Mn ${id}`, slug: `mn-${id}`, role },
    });
  }

  async function crearAnuncio(sellerId: string, title: string, status: 'ACTIVE' | 'PENDING_REVIEW') {
    return prisma.listing.create({
      data: {
        title,
        slug: `l-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId,
        categoryId,
        status,
      },
    });
  }

  const notifs = (userId: string, type?: string) =>
    prisma.notification.findMany({ where: { userId, ...(type && { type }) } });

  const emails = (name: string) =>
    addSpy.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // Al DENUNCIANTE
  // ===========================================================================

  describe('el denunciante sabe en qué acabó su denuncia', () => {
    it('resolver → REPORT_RESOLVED con outcome RESOLVED y el NOMBRE de lo denunciado', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Bicicleta sospechosa', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'FRAUD', reporterId: denunciante, listingId: anuncio.id },
      });

      await moderation.resolveReport(report.id, moderador);

      const avisos = await notifs(denunciante, 'REPORT_RESOLVED');
      expect(avisos).toHaveLength(1);
      const data = avisos[0].data as Record<string, unknown>;
      expect(data.outcome).toBe('RESOLVED');
      expect(data.targetType).toBe('LISTING');
      // NOMBRE resuelto, no el id: el aviso se pinta sin consultas.
      expect(data.targetLabel).toBe('Bicicleta sospechosa');
      expect(data.targetLabel).not.toBe(anuncio.id);
      expect(data.listingSlug).toBe(anuncio.slug);
    });

    it('desestimar → mismo aviso con outcome DISMISSED', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Anuncio correcto', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });

      await moderation.dismissReport(report.id, moderador);

      const [aviso] = await notifs(denunciante, 'REPORT_RESOLVED');
      expect((aviso.data as { outcome: string }).outcome).toBe('DISMISSED');
    });

    it('funciona con los TRES tipos de denuncia: anuncio, valoración y usuario', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Un anuncio', 'ACTIVE');
      const review = await prisma.review.create({
        data: { rating: 1, authorId: vendedor, targetId: denunciante, listingTitle: 'Mesa' },
      });

      const rAnuncio = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });
      const rReview = await prisma.report.create({
        data: { reason: 'FAKE_REVIEW', reporterId: denunciante, reviewId: review.id },
      });
      const rUser = await prisma.report.create({
        data: { reason: 'FRAUD', reporterId: denunciante, reportedUserId: vendedor },
      });

      await moderation.resolveReport(rAnuncio.id, moderador);
      await moderation.resolveReport(rReview.id, moderador);
      await moderation.resolveReport(rUser.id, moderador);

      const avisos = await notifs(denunciante, 'REPORT_RESOLVED');
      expect(avisos).toHaveLength(3);
      const tipos = avisos.map((a) => (a.data as { targetType: string }).targetType).sort();
      expect(tipos).toEqual(['LISTING', 'REVIEW', 'USER']);

      // El de usuario lleva el NOMBRE del usuario denunciado, no su id.
      const delUsuario = avisos.find((a) => (a.data as { targetType: string }).targetType === 'USER');
      const nombreVendedor = (await prisma.user.findUniqueOrThrow({ where: { id: vendedor } })).name;
      expect((delUsuario!.data as { targetLabel: string }).targetLabel).toBe(nombreVendedor);
    });

    // BORRADO B1 — ESTE CASO SE HA INVERTIDO A PROPÓSITO.
    //
    // Decía: «si el anuncio denunciado se borra, la denuncia se va con él y no hay
    // aviso huérfano», porque `Report.listingId` era `Cascade`. Y remataba que el
    // fallback de `resolveReportTarget` era «defensivo, no una ruta viva».
    //
    // B1 cambia ese `Cascade` por `SetNull`: mientras estuvo, **el denunciado podía
    // destruir la denuncia borrando su propio anuncio** —y borrar es, hoy, lo único
    // que el dueño puede hacer—. La denuncia ahora sobrevive, se puede resolver, y
    // el aviso al denunciante nombra el anuncio por el snapshot que se guardó al
    // crearla. Lo que era una ruta muerta pasa a ser la ruta normal.
    it('si el anuncio denunciado se borra, la DENUNCIA SOBREVIVE y su resolución sigue avisando', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Anuncio efímero', 'ACTIVE');
      const report = await prisma.report.create({
        data: {
          reason: 'SPAM',
          reporterId: denunciante,
          listingId: anuncio.id,
          listingTitle: 'Anuncio efímero',
        },
      });

      await prisma.listing.delete({ where: { id: anuncio.id } });

      // Sobrevive, sin anuncio pero con su contexto.
      const tras = await prisma.report.findUnique({ where: { id: report.id } });
      expect(tras).not.toBeNull();
      expect(tras!.listingId).toBeNull();

      // Y se puede despachar: es el punto entero de preservarla.
      await moderation.resolveReport(report.id, moderador);

      const avisos = await notifs(denunciante, 'REPORT_RESOLVED');
      expect(avisos).toHaveLength(1);
      const data = avisos[0].data as { targetType: string; targetLabel: string; listingSlug: string | null };
      // Sigue siendo una denuncia DE ANUNCIO — sin el snapshot caería al genérico
      // «el contenido denunciado» con targetType USER, que sería falso.
      expect(data.targetType).toBe('LISTING');
      expect(data.targetLabel).toBe('Anuncio efímero');
      // Sin enlace: la ficha ya no existe.
      expect(data.listingSlug).toBeNull();
    });

    it('una denuncia ANTERIOR a B1 (sin snapshot) degrada al genérico, no revienta', async () => {
      // Las denuncias creadas antes de la migración de B1 cuyo anuncio ya se había
      // borrado no tienen título que enseñar. El aviso sigue saliendo, con la
      // etiqueta genérica — que es para lo que ese fallback existía.
      const anuncio = await crearAnuncio(vendedor, 'Anuncio sin snapshot', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });
      await prisma.listing.delete({ where: { id: anuncio.id } });

      await moderation.resolveReport(report.id, moderador);

      const avisos = await notifs(denunciante, 'REPORT_RESOLVED');
      expect(avisos).toHaveLength(1);
      const data = avisos[0].data as { targetType: string; targetLabel: string };
      expect(data.targetType).toBe('USER');
      expect(data.targetLabel).toBe('el contenido denunciado');
    });

    it('NO se avisa al denunciante por email: solo campana', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Algo', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });

      await moderation.resolveReport(report.id, moderador);

      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Al VENDEDOR
  // ===========================================================================

  describe('el vendedor se entera de que le moderaron el anuncio', () => {
    it('desactivar → LISTING_MODERATED con el título congelado + email', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Silla de oficina', 'ACTIVE');

      await moderation.deactivateListing(anuncio.id, moderador, 'Contenido prohibido');

      const avisos = await notifs(vendedor, 'LISTING_MODERATED');
      expect(avisos).toHaveLength(1);
      const data = avisos[0].data as Record<string, unknown>;
      expect(data.action).toBe('DEACTIVATED');
      expect(data.listingTitle).toBe('Silla de oficina');
      expect(data.reason).toBe('Contenido prohibido');

      // Este SÍ lleva email: le han quitado presencia en el marketplace.
      const correos = emails(NOTIFICATION_JOB.SEND_LISTING_MODERATED);
      expect(correos).toHaveLength(1);
      expect(correos[0].action).toBe('DEACTIVATED');
      expect(correos[0].listingTitle).toBe('Silla de oficina');
    });

    it('rechazar → LISTING_MODERATED con action REJECTED', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Pendiente de revisión', 'PENDING_REVIEW');

      await moderation.rejectListing(anuncio.id, moderador, 'Fotos no válidas');

      const [aviso] = await notifs(vendedor, 'LISTING_MODERATED');
      expect((aviso.data as { action: string }).action).toBe('REJECTED');
    });

    it('restaurar → también avisa: avisar solo de lo malo sería media conversación', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Restaurado', 'PENDING_REVIEW');
      await moderation.rejectListing(anuncio.id, moderador, 'Error');
      await prisma.notification.deleteMany({});
      addSpy.mockClear();

      await moderation.restoreListing(anuncio.id, moderador);

      const [aviso] = await notifs(vendedor, 'LISTING_MODERATED');
      expect((aviso.data as { action: string }).action).toBe('RESTORED');
      expect(emails(NOTIFICATION_JOB.SEND_LISTING_MODERATED)).toHaveLength(1);
    });

    it('el aviso sobrevive al borrado posterior del anuncio (título congelado)', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Se borrará', 'ACTIVE');
      await moderation.deactivateListing(anuncio.id, moderador);
      await prisma.listing.delete({ where: { id: anuncio.id } });

      const [aviso] = await notifs(vendedor, 'LISTING_MODERATED');
      expect((aviso.data as { listingTitle: string }).listingTitle).toBe('Se borrará');
    });
  });

  // ===========================================================================
  // Valoración retirada
  // ===========================================================================

  describe('el autor de una valoración se entera de que se ha retirado', () => {
    it('retireReview → REVIEW_MODERATED al AUTOR, y la fila SOBREVIVE', async () => {
      const review = await prisma.review.create({
        data: { rating: 1, authorId: denunciante, targetId: vendedor, listingTitle: 'Mesa de roble' },
      });

      await moderation.retireReview(review.id, moderador, 'Insultos');

      // 7b — ESTA ASERCIÓN ESTÁ INVERTIDA A PROPÓSITO. Hasta 7b decía `toBeNull()`: el
      // borrado era FÍSICO, y con él se llevaba por `Cascade` la denuncia que lo había
      // motivado. Ahora la fila vive retirada, así que el `Cascade` no se dispara y la
      // denuncia sobrevive. El aviso al autor no cambia.
      const despues = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(despues.retiredAt).toBeInstanceOf(Date);
      expect(despues.retiredReason).toBe('Insultos');

      const [aviso] = await notifs(denunciante, 'REVIEW_MODERATED');
      const data = aviso.data as Record<string, unknown>;
      expect(data.rating).toBe(1);
      expect(data.listingTitle).toBe('Mesa de roble');
      const nombreVendedor = (await prisma.user.findUniqueOrThrow({ where: { id: vendedor } })).name;
      expect(data.targetName).toBe(nombreVendedor); // nombre resuelto, no id
      expect(data.targetName).not.toBe(vendedor);
    });

    it('sin email: retirar contenido por incumplir normas no se discute por correo', async () => {
      const review = await prisma.review.create({
        data: { rating: 2, authorId: denunciante, targetId: vendedor, listingTitle: null },
      });

      await moderation.retireReview(review.id, moderador, 'Contenido fuera de normas');

      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Los dos destinatarios no se cruzan
  // ===========================================================================

  describe('destinatarios distintos, avisos distintos', () => {
    it('denuncia sobre un anuncio que se retira: cada uno recibe SOLO lo suyo', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Anuncio denunciado', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'FRAUD', reporterId: denunciante, listingId: anuncio.id },
      });

      // Son DOS acciones separadas del moderador (endpoints distintos).
      await moderation.deactivateListing(anuncio.id, moderador, 'Fraude confirmado');
      await moderation.resolveReport(report.id, moderador);

      // El vendedor: solo el de su anuncio.
      const delVendedor = await notifs(vendedor);
      expect(delVendedor).toHaveLength(1);
      expect(delVendedor[0].type).toBe('LISTING_MODERATED');

      // El denunciante: solo el de su denuncia.
      const delDenunciante = await notifs(denunciante);
      expect(delDenunciante).toHaveLength(1);
      expect(delDenunciante[0].type).toBe('REPORT_RESOLVED');

      // Y el motivo interno del moderador no se le cuela al denunciante.
      expect(JSON.stringify(delDenunciante[0].data)).not.toContain('Fraude confirmado');
    });
  });

  // ===========================================================================
  // Caso límite: la propia acción
  // ===========================================================================

  describe('a nadie se le avisa de su propia acción', () => {
    it('un moderador que resuelve SU PROPIA denuncia no recibe aviso', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Algo', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: moderador, listingId: anuncio.id },
      });

      await moderation.resolveReport(report.id, moderador);

      expect(await notifs(moderador, 'REPORT_RESOLVED')).toHaveLength(0);
    });

    it('un moderador que modera SU PROPIO anuncio no recibe aviso ni email', async () => {
      const suyo = await crearAnuncio(moderador, 'Mi propio anuncio', 'ACTIVE');

      await moderation.deactivateListing(suyo.id, moderador, 'lo retiro yo');

      expect(await notifs(moderador, 'LISTING_MODERATED')).toHaveLength(0);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('pero denunciar tu propio anuncio y que OTRO lo retire sí da los dos avisos', async () => {
      // Son eventos distintos, de acciones distintas y con enlaces distintos:
      // no se suprimen. La única supresión es "tu propia acción".
      const propio = await crearAnuncio(denunciante, 'Mi anuncio', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'OTHER', reporterId: denunciante, listingId: propio.id },
      });

      await moderation.deactivateListing(propio.id, moderador, 'a revisión');
      await moderation.resolveReport(report.id, moderador);

      const suyos = await notifs(denunciante);
      expect(suyos.map((n) => n.type).sort()).toEqual(['LISTING_MODERATED', 'REPORT_RESOLVED']);
    });
  });

  // ===========================================================================
  // El aviso es EFECTO, no causa
  // ===========================================================================

  describe('el aviso va DESPUÉS de que la acción persista', () => {
    it('si la acción de moderación se RECHAZA, no se crea ninguna notificación', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Ya rechazado', 'PENDING_REVIEW');
      await moderation.rejectListing(anuncio.id, moderador);
      await prisma.notification.deleteMany({});
      addSpy.mockClear();

      // Rechazar dos veces: el guard de estado lo impide (solo PENDING_REVIEW).
      await expect(moderation.rejectListing(anuncio.id, moderador)).rejects.toThrow();
      // Y desactivar exige ACTIVE.
      await expect(moderation.deactivateListing(anuncio.id, moderador)).rejects.toThrow();

      expect(await prisma.notification.count()).toBe(0);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('resolver una denuncia ya cerrada no avisa dos veces', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Algo', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });

      await moderation.resolveReport(report.id, moderador);
      await expect(moderation.resolveReport(report.id, moderador)).rejects.toThrow();

      expect(await notifs(denunciante, 'REPORT_RESOLVED')).toHaveLength(1);
    });
  });

  // ===========================================================================
  // La lógica de moderación no cambió
  // ===========================================================================

  describe('la moderación sigue haciendo exactamente lo que hacía', () => {
    it('los estados y las acciones son los de siempre; el aviso solo se suma', async () => {
      const anuncio = await crearAnuncio(vendedor, 'Control', 'ACTIVE');
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: denunciante, listingId: anuncio.id },
      });

      const tras = await moderation.deactivateListing(anuncio.id, moderador, 'motivo');
      expect(tras.status).toBe('REJECTED'); // deactivate deja REJECTED, como siempre

      const reporte = await moderation.resolveReport(report.id, moderador);
      expect(reporte.status).toBe('RESOLVED');
      expect(reporte.resolvedById).toBe(moderador);
      expect(reporte.resolvedAt).toBeInstanceOf(Date);

      // Y el AuditLog de moderación sigue escribiéndose igual.
      const acciones = (await prisma.auditLog.findMany()).map((l) => l.action).sort();
      expect(acciones).toEqual(['LISTING_DEACTIVATE', 'REPORT_RESOLVE']);
    });
  });
});
