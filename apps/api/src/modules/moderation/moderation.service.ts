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

    await this.invalidateAndIndex(listing.slug, listingId);

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

    await this.invalidateAndIndex(listing.slug, listingId);

    await this.auditLog.log({
      action: 'LISTING_RESTORE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: ListingStatus.ACTIVE },
      ip,
    });

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
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async invalidateAndIndex(slug: string, listingId: string): Promise<void> {
    await this.redis.client.del(listingCacheKey(slug));
    await this.indexingQueue.add('index', { listingId });
  }
}
