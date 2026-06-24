import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ListingStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ExpirationService } from '../expiration/expiration.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';

const cacheKey = (slug: string) => `listing:${slug}`;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------------------

  async listListings(query: ListAdminListingsDto) {
    const { status, categoryId, sellerId, page = 1, perPage = 24 } = query;
    const where: Prisma.ListingWhereInput = {
      ...(status && { status }),
      ...(categoryId && { categoryId }),
      ...(sellerId && { sellerId }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          price: true,
          currency: true,
          priceType: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { id: true, name: true, slug: true } },
          seller: { select: { id: true, name: true, slug: true, email: true } },
          images: {
            orderBy: { order: 'asc' },
            take: 1,
            select: { url: true },
          },
          _count: { select: { reports: true } },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  async getListingById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        category: true,
        images: { orderBy: { order: 'asc' } },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            slug: true,
            status: true,
            role: true,
            createdAt: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reporter: { select: { id: true, name: true, slug: true } },
          },
        },
        _count: { select: { conversations: true } },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    return listing;
  }

  async changeListingStatus(
    listingId: string,
    actorId: string,
    dto: ChangeListingStatusDto,
    ip?: string,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    const before = { status: listing.status };

    // When transitioning to ACTIVE, ensure publishedAt and expiresAt are set.
    const updateData: Prisma.ListingUpdateInput = { status: dto.status };
    if (dto.status === ListingStatus.ACTIVE) {
      const publishedAt = listing.publishedAt ?? new Date();
      updateData.publishedAt = publishedAt;
      updateData.expiresAt = ExpirationService.expiresAt(publishedAt);
    }

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: updateData,
    });

    // Meilisearch + Redis side effects based on state transition.
    if (dto.status === ListingStatus.ACTIVE) {
      await this.redis.client.del(cacheKey(listing.slug));
      await this.indexingQueue.add('index', { listingId });
    } else if (listing.status === ListingStatus.ACTIVE) {
      // Moving away from ACTIVE: remove from search index + invalidate cache.
      await this.redis.client.del(cacheKey(listing.slug));
      await this.indexingQueue.add('remove', { listingId });
    }

    await this.auditLog.log({
      action: 'LISTING_STATUS_CHANGE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: dto.status, reason: dto.reason },
      ip,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  async listUsers(query: ListAdminUsersDto) {
    const { status, role, q, page = 1, perPage = 24 } = query;
    const where: Prisma.UserWhereInput = {
      ...(status && { status }),
      ...(role && { role }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          name: true,
          email: true,
          slug: true,
          role: true,
          status: true,
          emailVerified: true,
          city: true,
          province: true,
          createdAt: true,
          _count: { select: { listings: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        status: true,
        emailVerified: true,
        phone: true,
        avatarUrl: true,
        bio: true,
        city: true,
        province: true,
        postalCode: true,
        createdAt: true,
        updatedAt: true,
        listings: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            price: true,
            currency: true,
            priceType: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        reportsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reporter: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // AuditLogs where this user is the subject (actions taken against them).
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { resourceType: 'User', resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        actor: { select: { id: true, name: true, slug: true } },
      },
    });

    return { ...user, auditLogs };
  }

  async suspendUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.SUSPENDED, 'USER_SUSPEND', ip);
  }

  async banUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.BANNED, 'USER_BAN', ip);
  }

  async reinstateUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.ACTIVE, 'USER_REINSTATE', ip);
  }

  async changeUserRole(
    targetId: string,
    actorId: string,
    dto: ChangeUserRoleDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // INNEGOCIABLE: no se puede degradar a otro ADMIN (diseño §4.2).
    if (user.role === Role.ADMIN) {
      throw new ForbiddenException('No se puede cambiar el rol de un administrador');
    }

    // Second guard in case the DTO validation is bypassed.
    if ((dto.role as Role) === Role.ADMIN) {
      throw new ForbiddenException('No se puede asignar el rol de administrador desde aquí');
    }

    const before = { role: user.role };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        status: true,
      },
    });

    await this.auditLog.log({
      action: 'USER_ROLE_CHANGE',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { role: dto.role },
      ip,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async changeUserStatus(
    targetId: string,
    actorId: string,
    newStatus: UserStatus,
    action: string,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const before = { status: user.status };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { status: newStatus },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        status: true,
      },
    });

    await this.auditLog.log({
      action,
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { status: newStatus },
      ip,
    });

    return updated;
  }
}
