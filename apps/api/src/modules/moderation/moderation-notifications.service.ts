import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Listing, Report, Review } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB } from '../../infra/queue/notification.types';

/**
 * Avisos de MODERACIÓN (§14.5 del diseño de atención al usuario).
 *
 * Cierra los dos huecos que destapó la auditoría inicial de aquel sistema y que
 * no eran de tickets: **ninguna acción de moderación avisaba a nadie**. Al
 * denunciante no se le decía en qué acabó su denuncia, y a un vendedor le
 * retiraban el anuncio del marketplace sin una palabra — simplemente desaparecía.
 *
 * Servicio propio, igual que `TicketNotificationsService`: el "a quién se le
 * cuenta qué" es una preocupación distinta de "qué decide la moderación", y
 * mantenerla fuera es lo que permite que `ModerationService` conserve su lógica
 * intacta (sus 45 tests e2e siguen verdes sin editarse).
 *
 * DOS INVARIANTES, las mismas que en tickets:
 *
 * 1. **El aviso es efecto, nunca causa.** Nada de aquí escribe en `Report` ni en
 *    `Listing`. Se invoca DESPUÉS de que la acción de moderación haya persistido;
 *    si esta falla, no se avisa de nada.
 * 2. **Snapshot autocontenido**: nombres YA RESUELTOS, nunca ids, y títulos
 *    congelados para que el aviso siga siendo legible si la entidad se borra.
 *
 * Y una regla propia: **a nadie se le avisa de su propia acción** (ver
 * `esSuPropiaAccion`).
 */
@Injectable()
export class ModerationNotificationsService {
  private readonly logger = new Logger(ModerationNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /**
   * Un moderador que resuelve la denuncia que él mismo puso, o que modera su
   * propio anuncio, no necesita que le cuenten lo que acaba de hacer. Es la
   * única supresión: el resto de solapamientos (denunciar tu propio anuncio y
   * que otro admin lo retire) SÍ generan los dos avisos, porque son eventos
   * distintos, de acciones distintas y con enlaces distintos.
   */
  private esSuPropiaAccion(destinatarioId: string, actorId: string): boolean {
    return destinatarioId === actorId;
  }

  // ---------------------------------------------------------------------------
  // Al DENUNCIANTE — en qué acabó su denuncia
  // ---------------------------------------------------------------------------

  /**
   * `resolveReport` / `dismissReport`. Solo notificación in-app: el denunciante
   * no pierde nada y no hay nada que hacer con el aviso; y las denuncias son
   * muchas más que las moderaciones, así que un correo por cada una sería ruido.
   */
  async reportClosed(report: Report, outcome: 'RESOLVED' | 'DISMISSED', actorId: string) {
    if (this.esSuPropiaAccion(report.reporterId, actorId)) return;

    const target = await this.resolveReportTarget(report);

    await this.notifications.createNotification(report.reporterId, 'REPORT_RESOLVED', {
      reportId: report.id,
      outcome,
      targetType: target.type,
      targetLabel: target.label,
      listingSlug: target.listingSlug,
    });
  }

  /**
   * Resuelve QUÉ se denunció, con su nombre legible. Es la única consulta extra
   * de todo el módulo de avisos: `ModerationService` ya tiene el `Report` en la
   * mano, pero no los nombres de lo denunciado.
   *
   * Un `Report` puede apuntar a un anuncio, a una valoración o a un usuario (y la
   * validación de `createReport` solo exige que haya AL MENOS uno). Se elige el
   * más específico disponible, en el mismo orden que usa el flujo (c) de tickets.
   */
  private async resolveReportTarget(report: Report): Promise<{
    type: 'LISTING' | 'REVIEW' | 'USER';
    label: string;
    listingSlug: string | null;
  }> {
    // BORRADO B1 — SE MIRA TAMBIÉN EL SNAPSHOT, no sólo la FK.
    //
    // Antes de B1, `Report.listingId` era `Cascade`: si el anuncio se borraba, la
    // denuncia se iba con él y esta rama nunca veía un anuncio ausente (su fallback
    // era código defensivo, y así estaba documentado en el e2e de avisos).
    //
    // Con `SetNull`, la denuncia SOBREVIVE y su `listingId` queda a `null`. Mirar
    // sólo la FK haría que una denuncia de anuncio cayera por las tres ramas hasta
    // el genérico del final: un `warn` de «sin entidad denunciada» para un caso
    // normal, un `targetType: USER` que es falso, y el snapshot —creado justamente
    // para esto— desaprovechado.
    //
    // Mismo patrón que la rama de `REVIEW` de aquí abajo, que ya cae a
    // `review.listingTitle` por la misma razón.
    if (report.listingId || report.listingTitle) {
      const listing = report.listingId
        ? await this.prisma.listing.findUnique({
            where: { id: report.listingId },
            select: { title: true, slug: true },
          })
        : null;
      // El anuncio pudo borrarse entre la denuncia y su resolución: el aviso
      // sigue teniendo sentido, solo que sin enlace. El genérico queda para las
      // denuncias anteriores a B1, que no llevan snapshot.
      return {
        type: 'LISTING',
        label: listing?.title ?? report.listingTitle ?? 'un anuncio que ya no está disponible',
        listingSlug: listing?.slug ?? null,
      };
    }

    if (report.reviewId) {
      const review = await this.prisma.review.findUnique({
        where: { id: report.reviewId },
        select: { rating: true, listingTitle: true },
      });
      const sobre = review?.listingTitle ? ` sobre «${review.listingTitle}»` : '';
      return {
        type: 'REVIEW',
        label: review ? `una valoración de ${review.rating}★${sobre}` : 'una valoración ya retirada',
        listingSlug: null,
      };
    }

    if (report.reportedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: report.reportedUserId },
        select: { name: true },
      });
      return { type: 'USER', label: user?.name ?? 'un usuario', listingSlug: null };
    }

    // No debería ocurrir (createReport exige al menos uno), pero el aviso no es
    // sitio para reventar: se degrada a una etiqueta genérica.
    this.logger.warn(`Report ${report.id} sin entidad denunciada (ni listing, ni review, ni user).`);
    return { type: 'USER', label: 'el contenido denunciado', listingSlug: null };
  }

  // ---------------------------------------------------------------------------
  // Al VENDEDOR — su anuncio ha sido moderado
  // ---------------------------------------------------------------------------

  /**
   * `rejectListing` / `deactivateListing` / `restoreListing`.
   *
   * ÚNICO aviso de moderación CON EMAIL: al vendedor le quitan (o le devuelven)
   * presencia en el marketplace y tiene algo que hacer — corregir y reenviar —, y
   * puede tardar días en entrar en la aplicación. Hasta hoy el anuncio
   * desaparecía y punto.
   *
   * `listing` es la fila TAL Y COMO ESTABA (o queda): de ahí salen `sellerId` y
   * `title` sin ninguna consulta extra.
   */
  async listingModerated(
    listing: Pick<Listing, 'id' | 'title' | 'sellerId'>,
    action: 'APPROVED' | 'REJECTED' | 'DEACTIVATED' | 'RESTORED',
    actorId: string,
    reason?: string,
  ) {
    if (this.esSuPropiaAccion(listing.sellerId, actorId)) return;

    await this.notifications.createNotification(listing.sellerId, 'LISTING_MODERATED', {
      listingId: listing.id,
      // Congelado: el aviso sobrevive al borrado del anuncio.
      listingTitle: listing.title,
      action,
      reason: reason ?? null,
    });

    const seller = await this.prisma.user.findUnique({
      where: { id: listing.sellerId },
      select: { email: true, name: true },
    });
    if (!seller) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_LISTING_MODERATED, {
      email: seller.email,
      name: seller.name,
      listingTitle: listing.title,
      action,
      reason: reason ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Al AUTOR de una valoración — se ha retirado
  // ---------------------------------------------------------------------------

  /**
   * `deleteReview`. El borrado es FÍSICO e irreversible, así que el aviso se
   * construye con la fila que el servicio ya cargó ANTES de borrarla — después
   * no habría de dónde sacarlo.
   *
   * Solo in-app, sin email: una valoración se retira por incumplir las normas, y
   * un correo de "hemos borrado lo que escribiste" invita a discutir algo que ya
   * no tiene vuelta atrás. La campana informa sin escalar.
   */
  async reviewModerated(
    review: Pick<Review, 'id' | 'authorId' | 'targetId' | 'rating' | 'listingTitle'>,
    actorId: string,
  ) {
    if (this.esSuPropiaAccion(review.authorId, actorId)) return;

    const target = await this.prisma.user.findUnique({
      where: { id: review.targetId },
      select: { name: true },
    });

    await this.notifications.createNotification(review.authorId, 'REVIEW_MODERATED', {
      reviewId: review.id,
      rating: review.rating,
      listingTitle: review.listingTitle,
      targetName: target?.name ?? 'otro usuario',
    });
  }
}
