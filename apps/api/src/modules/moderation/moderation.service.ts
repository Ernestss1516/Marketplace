import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ListingStatus, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ListingExpiryService } from '../expiration/listing-expiry.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListingActivationService } from '../listing-activation/listing-activation.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { ModerationNotificationsService } from './moderation-notifications.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';

const listingCacheKey = (slug: string) => `listing:${slug}`;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    private readonly activation: ListingActivationService,
    private readonly gate: ListingGateService,
    // §14.5 — los avisos. Servicio APARTE: la lógica de moderación (transiciones
    // de Report, guards, acciones sobre el anuncio) no cambia; solo gana un
    // efecto posterior, siempre después de que la acción haya persistido.
    private readonly notify: ModerationNotificationsService,
    // AJUSTES RÁFAGA A — el plazo de caducidad, ahora leído del `Setting` `listingExpiryDays`
    // en vez de una constante. AL FINAL DE LA LISTA, por la nota de los parámetros de arriba.
    private readonly listingExpiry: ListingExpiryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  async createReport(reporterId: string, dto: CreateReportDto) {
    if (!dto.listingId && !dto.reportedUserId && !dto.reviewId) {
      throw new UnprocessableEntityException(
        'Se requiere listingId, reportedUserId o reviewId',
      );
    }

    // BORRADO B1 — se trae también el TÍTULO, no sólo el id. La comprobación de
    // existencia ya estaba; el título es el snapshot que mantiene legible la
    // denuncia si el anuncio desaparece después (`Report.listingTitle`). Se toma
    // AQUÍ, al crear, y no en el borrado: ver la nota del campo en el schema.
    let listingTitle: string | undefined;
    if (dto.listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { id: true, title: true },
      });
      if (!listing) throw new NotFoundException('Anuncio no encontrado');
      listingTitle = listing.title;
    }

    // BORRADO DE CUENTAS C1 — la TERCERA arista del mismo snapshot, y por el mismo
    // motivo que las dos de arriba: se trae también el NOMBRE, no sólo el id.
    //
    // QUÉ CIERRA. Eliminar una cuenta no borra su fila: la VACÍA, poniendo `name` a
    // «Usuario eliminado». Como la cola de moderación lee el nombre POR LA RELACIÓN,
    // sin este snapshot todas las denuncias contra esa persona pasarían a decir
    // «denuncia contra Usuario eliminado»: sobrevivirían sin decir CONTRA QUIÉN, que
    // es la mitad de lo que una denuncia es.
    //
    // NO CUESTA UNA CONSULTA: la comprobación de existencia ya estaba aquí y ya
    // consultaba esta misma fila; sólo se le añade una columna al `select`. Es
    // literalmente lo que hizo B1 con el título del anuncio.
    //
    // Se toma AQUÍ, al crear, y no en la eliminación: rellenarlo allí convertiría esa
    // operación en una escritura de N filas dentro de la transacción, y sería un
    // camino que sólo se ejecuta ahí — o sea que sólo se prueba ahí.
    let reportedUserName: string | undefined;
    if (dto.reportedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.reportedUserId },
        select: { id: true, name: true },
      });
      if (!user) throw new NotFoundException('Usuario no encontrado');
      reportedUserName = user.name;
    }

    // Mismo molde que el título del anuncio, en la otra arista: se trae también el
    // COMENTARIO y el NOMBRE DE SU AUTOR, no sólo el id. Es el snapshot que mantiene
    // legible la denuncia si la valoración desaparece después (`Report.reviewComment`
    // / `reviewAuthorName`), ahora que `reviewId` es `SetNull` y ya no la arrastra.
    // Se toma AQUÍ, al crear, y no en el borrado: ver la nota del campo en el schema.
    let reviewComment: string | null | undefined;
    let reviewAuthorName: string | null | undefined;
    if (dto.reviewId) {
      const review = await this.prisma.review.findUnique({
        where: { id: dto.reviewId },
        select: { id: true, comment: true, author: { select: { name: true } } },
      });
      if (!review) throw new NotFoundException('Valoración no encontrada');
      reviewComment = review.comment;
      reviewAuthorName = review.author.name;
    }

    const data = {
      reason: dto.reason,
      description: dto.description,
      reporterId,
      listingId: dto.listingId,
      listingTitle,
      reportedUserId: dto.reportedUserId,
      reportedUserName,
      reviewId: dto.reviewId,
      reviewComment,
      reviewAuthorName,
    };
    return this.prisma.report.create({ data });
  }

  async listReports(query: ListReportsQueryDto) {
    const { status, reason, page = 1, perPage = 24 } = query;
    const where = {
      ...(status !== undefined && { status }),
      ...(reason !== undefined && { reason }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          reporter: { select: { id: true, name: true, slug: true } },
          reportedUser: { select: { id: true, name: true, slug: true } },
          listing: { select: { id: true, title: true, slug: true, status: true } },
          // 7b — `retiredAt` viaja porque la cola tiene que distinguir «denuncia sobre una
          // valoración que sigue publicada» de «ya retirada, esto es un duplicado». Sin él,
          // el botón ofrecería retirar algo ya retirado y el servidor devolvería un 409.
          review: {
            select: {
              id: true,
              rating: true,
              comment: true,
              retiredAt: true,
              // `id` ADEMÁS del nombre: la ficha de usuario del backoffice es por
              // id, y sin él la cola no podía enlazar ni al autor ni al destinatario
              // de una valoración denunciada — que son las dos personas que hay que
              // mirar para juzgar si una reseña es falsa.
              author: { select: { id: true, name: true, slug: true } },
              target: { select: { id: true, name: true, slug: true } },
            },
          },
          resolvedBy: { select: { id: true, name: true } },
          // Atención al usuario R7 — hilos ya abiertos con el usuario reportado
          // desde esta denuncia (flujo c). SOLO LECTURA y solo dos campos: la
          // ficha necesita enseñar "ya hay hilo, aquí está" para no abrir dos.
          // El ciclo de vida del Report NO cambia: sigue siendo suyo, y resolver
          // la denuncia y cerrar el hilo siguen siendo acciones independientes
          // (§8.3). Añadir un campo al payload es aditivo — ningún test de
          // moderación afirma la forma exacta de la respuesta.
          tickets: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async getReport(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, name: true, slug: true, email: true } },
        reportedUser: { select: { id: true, name: true, slug: true } },
        listing: {
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            seller: { select: { id: true, name: true, slug: true } },
          },
        },
        // Las dos relaciones que el LISTADO ya servía y la ficha no: sin ellas,
        // la pantalla de detalle de una denuncia sobre una valoración enseñaría
        // MENOS que la fila de la que se llega, y no podría decir si ya hay un
        // hilo abierto con el denunciado. Aditivo: quien sólo leía lo de antes
        // sigue leyéndolo igual.
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            retiredAt: true,
            author: { select: { id: true, name: true, slug: true } },
            target: { select: { id: true, name: true, slug: true } },
          },
        },
        tickets: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    return report;
  }

  async startReview(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.status !== ReportStatus.PENDING) {
      throw new BadRequestException('Solo se pueden iniciar reportes en estado PENDING');
    }
    return this.prisma.report.update({
      where: { id },
      data: { status: ReportStatus.REVIEWING },
    });
  }

  async resolveReport(id: string, actorId: string, ip?: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (
      report.status !== ReportStatus.PENDING &&
      report.status !== ReportStatus.REVIEWING
    ) {
      throw new BadRequestException('El reporte ya está cerrado');
    }

    const before = { status: report.status };
    const now = new Date();

    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: ReportStatus.RESOLVED, resolvedById: actorId, resolvedAt: now },
    });

    await this.auditLog.log({
      action: 'REPORT_RESOLVE',
      actorId,
      resourceType: 'Report',
      resourceId: id,
      before,
      after: { status: ReportStatus.RESOLVED },
      ip,
    });

    // §14.5 — TRAS persistir: el denunciante sabe en qué acabó su denuncia.
    await this.notify.reportClosed(report, 'RESOLVED', actorId);

    return updated;
  }

  async dismissReport(id: string, actorId: string, ip?: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (
      report.status !== ReportStatus.PENDING &&
      report.status !== ReportStatus.REVIEWING
    ) {
      throw new BadRequestException('El reporte ya está cerrado');
    }

    const before = { status: report.status };
    const now = new Date();

    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: ReportStatus.DISMISSED, resolvedById: actorId, resolvedAt: now },
    });

    await this.auditLog.log({
      action: 'REPORT_DISMISS',
      actorId,
      resourceType: 'Report',
      resourceId: id,
      before,
      after: { status: ReportStatus.DISMISSED },
      ip,
    });

    // §14.5 — TRAS persistir. Desestimar también es un desenlace: quien denunció
    // merece saberlo tanto como si se le hubiera dado la razón.
    await this.notify.reportClosed(report, 'DISMISSED', actorId);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Listing moderation actions
  // ---------------------------------------------------------------------------

  async approveListing(listingId: string, actorId: string, ip?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.status !== ListingStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Solo se pueden aprobar anuncios en estado PENDING_REVIEW',
      );
    }

    // PUERTA — acción de STAFF. Pasa por la puerta como cualquier otro camino
    // a ACTIVE; lo que cambia es el contexto: la regla de cuota declara que no
    // aplica a staff (ver ActiveListingLimitRule.appliesTo), así que un moderador
    // sigue pudiendo activar por encima del cupo del vendedor. Lo que antes era
    // una ausencia de facto es ahora una línea declarativa.
    await this.gate.assertCanBecomeActive(listing, {
      actor: 'staff', transition: 'approve', actorId,
    });

    const before = { status: listing.status };
    const publishedAt = listing.publishedAt ?? new Date();

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.ACTIVE,
        publishedAt,
        expiresAt: await this.listingExpiry.expiresAt(publishedAt),
      },
    });

    await this.activation.listingBecameActive(listing.slug, listingId);

    await this.auditLog.log({
      action: 'LISTING_APPROVE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: ListingStatus.ACTIVE },
      ip,
    });

    // MODERACIÓN M2 — EL AVISO QUE FALTABA. Aprobar era la única de las cuatro
    // acciones de moderación que no decía nada al vendedor: rechazar, desactivar
    // y restaurar sí avisaban desde §14.5. Mientras a `PENDING_REVIEW` sólo se
    // llegaba por palabra prohibida el silencio era un detalle; con la moderación
    // previa, pasar por revisión es el caso normal, y no avisar deja al vendedor
    // sin saber si su anuncio sigue en la cola o ya se está viendo.
    //
    // TRAS persistir y con la fila PREVIA, igual que las otras tres: de ahí salen
    // `sellerId` y `title` sin una consulta extra.
    await this.notify.listingModerated(listing, 'APPROVED', actorId);

    return updated;
  }

  async rejectListing(
    listingId: string,
    actorId: string,
    reason?: string,
    ip?: string,
  ) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.status !== ListingStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Solo se pueden rechazar anuncios en estado PENDING_REVIEW',
      );
    }

    const before = { status: listing.status };

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.REJECTED },
    });

    await this.auditLog.log({
      action: 'LISTING_REJECT',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: ListingStatus.REJECTED, reason },
      ip,
    });

    // §14.5 — TRAS persistir. `listing` es la fila previa: de ahí salen sellerId
    // y title sin ninguna consulta extra.
    await this.notify.listingModerated(listing, 'REJECTED', actorId, reason);

    return updated;
  }

  async deactivateListing(
    listingId: string,
    actorId: string,
    reason?: string,
    ip?: string,
  ) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException(
        'Solo se pueden desactivar anuncios en estado ACTIVE',
      );
    }

    const before = { status: listing.status };

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.REJECTED },
    });

    // Remove from Meilisearch + invalidate Redis cache.
    await this.redis.client.del(listingCacheKey(listing.slug));
    await this.indexingQueue.add('remove', { listingId });

    await this.auditLog.log({
      action: 'LISTING_DEACTIVATE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: ListingStatus.REJECTED, reason },
      ip,
    });

    // §14.5 — TRAS persistir. Este es EL hueco que motivó la ráfaga: hasta hoy
    // el anuncio desaparecía del marketplace sin que al vendedor le llegara nada.
    await this.notify.listingModerated(listing, 'DEACTIVATED', actorId, reason);

    return updated;
  }

  async restoreListing(listingId: string, actorId: string, ip?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.status !== ListingStatus.REJECTED) {
      throw new BadRequestException(
        'Solo se pueden restaurar anuncios en estado REJECTED',
      );
    }

    // PUERTA — acción de STAFF, igual que en approveListing (ver allí el porqué
    // de que la cuota no le aplique).
    await this.gate.assertCanBecomeActive(listing, {
      actor: 'staff', transition: 'restore', actorId,
    });

    const before = { status: listing.status };
    const publishedAt = listing.publishedAt ?? new Date();

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.ACTIVE,
        publishedAt,
        expiresAt: await this.listingExpiry.expiresAt(publishedAt),
      },
    });

    await this.activation.listingBecameActive(listing.slug, listingId);

    await this.auditLog.log({
      action: 'LISTING_RESTORE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: ListingStatus.ACTIVE },
      ip,
    });

    // §14.5 — TRAS persistir. Restaurar es deshacer una moderación: si al
    // vendedor se le avisó de que se lo retiraban, hay que avisarle también de
    // que vuelve. Avisar solo de lo malo sería la mitad de la conversación.
    await this.notify.listingModerated(listing, 'RESTORED', actorId);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Review moderation actions
  // ---------------------------------------------------------------------------

  /**
   * 7b — RETIRAR UNA VALORACIÓN. Sustituye a `deleteReview`, que borraba la fila.
   *
   * ─── QUÉ FUEGO APAGA ─────────────────────────────────────────────────────────
   *
   * El borrado era FÍSICO, y `Report.reviewId` era `Cascade`: cada uso **destruía la
   * denuncia que había motivado la retirada**. Y el flujo de la cola de denuncias
   * —borrar y acto seguido resolver el reporte— acababa llamando a `resolveReport` sobre
   * un reporte que ya no existía, o sea con un `NotFoundException` en la cara del
   * moderador. **Estaba roto el 100 % de las veces**, igual que el enlace de la cola de
   * revisión que arregló F1.
   *
   * B1 dejó ese defecto anotado como «riesgo 5, fuera de alcance porque va de reseñas».
   * Esto es «va de reseñas».
   *
   * Con la fila viva, el `Cascade` **no se disparaba nunca**: la denuncia sobrevive
   * apuntando a una fila que existe, y `resolveReport` la encuentra. Eso lo dejaba
   * NEUTRALIZADO, no resuelto; **ya está resuelto aparte**: `Report.reviewId` es
   * `SetNull` + snapshot (`reviewComment` / `reviewAuthorName`), así que una supresión
   * real futura tampoco destruiría la denuncia. La retirada lógica sigue siendo lo
   * correcto igualmente, por lo de arriba (es reversible; borrar no).
   *
   * REVERSIBLE, y por eso MODERATOR (criterio B2: ADMIN sólo para lo irreversible).
   * `restoreReview` la devuelve entera — a la media y al perfil.
   */
  async retireReview(reviewId: string, actorId: string, reason: string, ip?: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (review.retiredAt) {
      throw new BadRequestException('Esta valoración ya está retirada');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { retiredAt: new Date(), retiredById: actorId, retiredReason: reason },
    });

    await this.auditLog.log({
      action: 'REVIEW_RETIRE',
      actorId,
      resourceType: 'Review',
      resourceId: reviewId,
      before: { rating: review.rating, comment: review.comment, retiredAt: null },
      after: { retiredAt: updated.retiredAt, reason },
      ip,
    });

    // §14.5 — TRAS persistir. El autor se entera, igual que se enteraba con el borrado:
    // que el equipo retire una opinión firmada por alguien sin decírselo no es defendible.
    // N2 — con su MOTIVO. `reason` es obligatorio en este método desde 7b y hasta
    // ahora sólo llegaba al `AuditLog`: al autor se le retiraba lo que había
    // escrito y se le comunicaba sin decirle por qué.
    await this.notify.reviewModerated(review, actorId, 'RETIRED', reason);
    return updated;
  }

  /** 7b — deshacer una retirada. La valoración vuelve a la media y al perfil. */
  async restoreReview(reviewId: string, actorId: string, ip?: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (!review.retiredAt) {
      throw new BadRequestException('Esta valoración no está retirada');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { retiredAt: null, retiredById: null, retiredReason: null },
    });

    await this.auditLog.log({
      action: 'REVIEW_RESTORE',
      actorId,
      resourceType: 'Review',
      resourceId: reviewId,
      before: { retiredAt: review.retiredAt, reason: review.retiredReason },
      after: { retiredAt: null },
      ip,
    });

    /**
     * NOTIFICACIONES N4a — LA ASIMETRÍA, CERRADA.
     *
     * Retirar avisaba al autor desde §14.5; devolverle la valoración a la media y
     * al perfil no le decía nada. Es exactamente lo que `restoreListing` tuvo que
     * corregir, y su comentario vale palabra por palabra: **«avisar solo de lo malo
     * sería la mitad de la conversación»**. Quien recibió «hemos retirado tu
     * valoración» tiene derecho a saber que ha vuelto.
     *
     * SIN MOTIVO (`null`): deshacer una retirada no se justifica ante quien se
     * beneficia de ella.
     */
    await this.notify.reviewModerated(review, actorId, 'RESTORED', null);

    return updated;
  }

  /**
   * 7b — EDITAR el texto o las estrellas de una valoración ajena.
   *
   * ES MODERACIÓN EXPLÍCITA, y de ahí las tres cosas que NO hace:
   *
   *   · **No toca `editedAt`.** Ese campo significa «el AUTOR la editó» y el frontal
   *     pinta «Editada» con él. Usarlo aquí diría que el autor cambió de opinión —
   *     mentiría al lector sobre quién escribió lo que está leyendo. Es el mismo cuidado
   *     que P1 tuvo con `EDITED`: una señal que afirma un hecho sólo la escribe quien
   *     puede saber que ocurrió.
   *   · **No toca `verified`.** Está congelado al crear y «NUNCA recalculado (ni por
   *     `edit()`, ni por ningún otro endpoint)» — `schema.prisma`.
   *   · **No recalcula ninguna media.** No hay ninguna: `average`, `count` y
   *     `distribution` se calculan al vuelo en cada lectura, así que cambiar 1★ por 3★ se
   *     refleja solo. Nada que desincronizar.
   *
   * RETIRAR ES LA VÍA PREFERENTE para lo abusivo. Esto se reserva para recortar lo
   * problemático de una valoración mayormente válida — y por eso el motivo es obligatorio.
   */
  async editReview(
    reviewId: string,
    actorId: string,
    input: { rating?: number; comment?: string | null; reason: string },
    ip?: string,
  ) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (input.rating === undefined && input.comment === undefined) {
      throw new BadRequestException('Nada que cambiar: manda `rating`, `comment` o ambos.');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.comment !== undefined && { comment: input.comment }),
        // AQUÍ NO HAY `editedAt` NI `verified`. Es la diferencia entera con `edit()`,
        // el camino del autor.
      },
    });

    await this.auditLog.log({
      action: 'REVIEW_EDIT',
      actorId,
      resourceType: 'Review',
      resourceId: reviewId,
      before: { rating: review.rating, comment: review.comment },
      after: { rating: updated.rating, comment: updated.comment, reason: input.reason },
      ip,
    });

    // §14.5 — TRAS persistir. NOTIFICACIONES A1: `'EDITED'`, y no el aviso de
    // retirada que se mandaba hasta aquí. Esto edita el texto o las estrellas de
    // una valoración que SIGUE PUBLICADA; decirle a su autor que se la habían
    // retirado «por incumplir las normas» era falso sobre el estado de algo que él
    // firmó. Es el mismo cuidado que este método ya tenía con `editedAt` —no
    // afirmar un hecho que no ocurrió—, que no había llegado al aviso.
    await this.notify.reviewModerated(review, actorId, 'EDITED', input.reason);
    return updated;
  }
}
