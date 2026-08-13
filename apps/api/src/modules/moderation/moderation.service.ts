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
import { ExpirationService } from '../expiration/expiration.service';
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

    if (dto.listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { id: true },
      });
      if (!listing) throw new NotFoundException('Anuncio no encontrado');
    }

    if (dto.reportedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.reportedUserId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Usuario no encontrado');
    }

    if (dto.reviewId) {
      const review = await this.prisma.review.findUnique({
        where: { id: dto.reviewId },
        select: { id: true },
      });
      if (!review) throw new NotFoundException('Valoración no encontrada');
    }

    const data = {
      reason: dto.reason,
      description: dto.description,
      reporterId,
      listingId: dto.listingId,
      reportedUserId: dto.reportedUserId,
      reviewId: dto.reviewId,
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
          review: { select: { id: true, rating: true, comment: true, author: { select: { name: true, slug: true } }, target: { select: { name: true, slug: true } } } },
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
        expiresAt: ExpirationService.expiresAt(publishedAt),
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
        expiresAt: ExpirationService.expiresAt(publishedAt),
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

  async deleteReview(reviewId: string, actorId: string, ip?: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Valoración no encontrada');

    const before = { rating: review.rating, comment: review.comment };

    await this.prisma.review.delete({ where: { id: reviewId } });

    await this.auditLog.log({
      action: 'REVIEW_DELETE',
      actorId,
      resourceType: 'Review',
      resourceId: reviewId,
      before,
      ip,
    });

    // §14.5 — TRAS persistir. El borrado es FÍSICO: el aviso se construye con la
    // fila `review` que se cargó ANTES de borrarla, porque después no habría de
    // dónde sacar el dato.
    await this.notify.reviewModerated(review, actorId);
  }

}
