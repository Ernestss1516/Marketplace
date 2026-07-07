import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ListingStatus,
  Prisma,
  ReportStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ExpirationService } from '../expiration/expiration.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { SetUserTrustedDto } from './dto/set-user-trusted.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { AttributeField, resolveEffectiveSchema } from '../categories/category.types';
import { VARIABLE_ATTRIBUTE_KEYS } from '../search/search.service';

const cacheKey = (slug: string) => `listing:${slug}`;

// Mirrors the constant in SearchService — must stay in sync with MEILI_INDEX_NAME env.
const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';

// Keys the admin is allowed to update via PATCH /admin/settings/:key.
const SETTING_KEYS = [
  'badWordList',
  'listingExpiryDays',
  'contactRequiresVerification',
  // RF.7: active listing limits per plan
  'freeActiveListingLimit',
  'proActiveListingLimit',
  // H8.1: monthly free-featured quota granted to Pro subscribers
  'proMonthlyFeaturedQuota',
  // H8.5a: fixed duration of a featured grant paid from the quota
  'proQuotaFeaturedDurationDays',
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly meili: MeilisearchService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // ===========================================================================
  // Listings (R7.4)
  // ===========================================================================

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

    // Ensure timestamps are set when transitioning to ACTIVE.
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

    // Meilisearch + Redis side effects.
    if (dto.status === ListingStatus.ACTIVE) {
      await this.redis.client.del(cacheKey(listing.slug));
      await this.indexingQueue.add('index', { listingId });
    } else if (listing.status === ListingStatus.ACTIVE) {
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

  // ===========================================================================
  // Users (R7.4)
  // ===========================================================================

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
          trusted: true,
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
        trusted: true,
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

  // Reverses a suspension (SUSPENDED → ACTIVE). Accessible to MODERATOR+ADMIN.
  // Throws 400 if the user is not currently SUSPENDED (use reinstateUser for BANNED).
  async unsuspendUser(targetId: string, actorId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.status !== UserStatus.SUSPENDED) {
      throw new BadRequestException(
        'Solo se pueden reactivar usuarios en estado SUSPENDED. Para BANNED, usa desbanear.',
      );
    }
    return this.changeUserStatus(targetId, actorId, UserStatus.ACTIVE, 'USER_UNSUSPEND', ip);
  }

  async banUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.BANNED, 'USER_BAN', ip);
  }

  // Reverses a ban (BANNED → ACTIVE). ADMIN-only.
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
    if ((dto.role as Role) === Role.ADMIN) {
      throw new ForbiddenException('No se puede asignar el rol de administrador desde aquí');
    }

    const before = { role: user.role };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role },
      select: { id: true, name: true, email: true, slug: true, role: true, status: true },
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

  // H8 Bloque E — "Vendedor de confianza": decisión de plataforma, ADMIN-only
  // (ver @Roles en el controller). Independiente de Pro: no se deriva de isProActive
  // ni al revés.
  async setUserTrusted(
    targetId: string,
    actorId: string,
    dto: SetUserTrustedDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const before = { trusted: user.trusted };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { trusted: dto.trusted },
      select: { id: true, name: true, email: true, slug: true, role: true, status: true, trusted: true },
    });

    await this.auditLog.log({
      action: dto.trusted ? 'USER_TRUST' : 'USER_UNTRUST',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { trusted: dto.trusted },
      ip,
    });

    return updated;
  }

  // ===========================================================================
  // Categories (R7.5)
  // ===========================================================================

  getCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        order: true,
        attributeSchema: true,
        children: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            iconUrl: true,
            order: true,
            attributeSchema: true,
          },
        },
      },
    });
  }

  private async validateCardAttributeLimit(
    ownSchema: AttributeField[],
    parentId: string | null | undefined,
  ): Promise<void> {
    let parentSchema: AttributeField[] = [];
    if (parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: parentId },
        select: { attributeSchema: true },
      });
      if (parent) parentSchema = (parent.attributeSchema as unknown as AttributeField[]) ?? [];
    }
    const effective = resolveEffectiveSchema(ownSchema, parentSchema);
    const cardCount = effective.filter((f) => f.cardAttribute).length;
    if (cardCount > 2) {
      throw new BadRequestException(
        `El schema efectivo tiene ${cardCount} atributos con cardAttribute:true pero el máximo permitido es 2.`,
      );
    }
  }

  async createCategory(actorId: string, dto: CreateCategoryDto, ip?: string) {
    if (dto.attributeSchema) {
      await this.validateCardAttributeLimit(dto.attributeSchema as AttributeField[], dto.parentId);
    }
    try {
      const created = await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          parentId: dto.parentId,
          iconUrl: dto.iconUrl,
          order: dto.order ?? 0,
          ...(dto.attributeSchema !== undefined && {
            attributeSchema: dto.attributeSchema as Prisma.InputJsonValue,
          }),
        },
      });

      await this.auditLog.log({
        action: 'CATEGORY_CREATE',
        actorId,
        resourceType: 'Category',
        resourceId: created.id,
        after: { name: created.name, slug: created.slug },
        ip,
      });

      return created;
    } catch (e) {
      if (isP2002(e)) {
        throw new ConflictException('Ya existe una categoría con ese slug');
      }
      throw e;
    }
  }

  async updateCategory(
    id: string,
    actorId: string,
    dto: UpdateCategoryDto,
    ip?: string,
  ) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    if (dto.attributeSchema) {
      await this.validateCardAttributeLimit(
        dto.attributeSchema as AttributeField[],
        category.parentId,
      );
    }

    const before = { name: category.name, slug: category.slug, order: category.order };

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.attributeSchema !== undefined && {
            attributeSchema: dto.attributeSchema as Prisma.InputJsonValue,
          }),
        },
      });

      await this.auditLog.log({
        action: 'CATEGORY_EDIT',
        actorId,
        resourceType: 'Category',
        resourceId: id,
        before,
        after: { name: updated.name, slug: updated.slug, order: updated.order },
        ip,
      });

      return updated;
    } catch (e) {
      if (isP2002(e)) {
        throw new ConflictException('Ya existe una categoría con ese slug');
      }
      throw e;
    }
  }

  async reorderCategories(
    actorId: string,
    dto: ReorderCategoriesDto,
    ip?: string,
  ) {
    await this.prisma.$transaction(
      dto.items.map(({ id, order }) =>
        this.prisma.category.update({ where: { id }, data: { order } }),
      ),
    );

    await this.auditLog.log({
      action: 'CATEGORY_REORDER',
      actorId,
      resourceType: 'Category',
      resourceId: 'batch',
      after: { items: dto.items as unknown as Prisma.InputJsonValue },
      ip,
    });
  }

  getSearchableAttributeKeys(): { keys: readonly string[] } {
    return { keys: VARIABLE_ATTRIBUTE_KEYS };
  }

  // Cuenta cuántos anuncios de una categoría tienen datos bajo `key` en su
  // JSON `attributes` (operador jsonb `?` = existencia de clave de nivel
  // superior). Usado por el editor de atributos para avisar antes de
  // renombrar una key con datos existentes (no migra nada, solo informa).
  async getAttributeUsage(categoryId: string, key: string): Promise<{ count: number }> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Listing"
      WHERE "categoryId" = ${categoryId}
        AND "attributes" ? ${key}
    `;
    return { count: Number(rows[0]?.count ?? 0) };
  }

  async deleteCategory(id: string, actorId: string, ip?: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // Cuenta TODOS los anuncios de la categoría, sin filtrar por status. La
    // constraint física Listing_categoryId_fkey es RESTRICT sobre cualquier
    // Listing (no solo ACTIVE); si aquí solo se contaran los ACTIVE, una
    // categoría con anuncios DRAFT/SOLD/EXPIRED/etc. pasaría este chequeo y el
    // DELETE físico posterior fallaría con un 500 sin controlar (RESTRICT de
    // Postgres) en vez de este 400 legible.
    const [totalListings, children] = await this.prisma.$transaction([
      this.prisma.listing.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);

    if (totalListings > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${totalListings} anuncio(s)`,
      );
    }
    if (children > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${children} subcategoría(s)`,
      );
    }

    await this.prisma.category.delete({ where: { id } });

    await this.auditLog.log({
      action: 'CATEGORY_DELETE',
      actorId,
      resourceType: 'Category',
      resourceId: id,
      before: { name: category.name, slug: category.slug },
      ip,
    });
  }

  // ===========================================================================
  // Settings (R7.5)
  // ===========================================================================

  getSettings() {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  async updateSetting(
    key: string,
    actorId: string,
    dto: UpdateSettingDto,
    ip?: string,
  ) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Clave '${key}' no permitida. Claves válidas: ${SETTING_KEYS.join(', ')}`,
      );
    }

    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Setting '${key}' no encontrado`);

    const before = { value: setting.value } as unknown as Prisma.InputJsonValue;
    const after = { value: dto.value } as unknown as Prisma.InputJsonValue;

    const updated = await this.prisma.setting.update({
      where: { key },
      data: {
        value: dto.value as Prisma.InputJsonValue,
        updatedById: actorId,
      },
    });

    await this.auditLog.log({
      action: 'SETTING_UPDATE',
      actorId,
      resourceType: 'Setting',
      resourceId: key,
      before,
      after,
      ip,
    });

    return updated;
  }

  // ===========================================================================
  // Stats dashboard (R7.5)
  // ===========================================================================

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      listingsActive,
      listingsPendingReview,
      listingsPublishedToday,
      usersTotal,
      usersNewToday,
      reportsPending,
      conversationsTotal,
    ] = await this.prisma.$transaction([
      this.prisma.listing.count({ where: { status: ListingStatus.ACTIVE } }),
      this.prisma.listing.count({ where: { status: ListingStatus.PENDING_REVIEW } }),
      this.prisma.listing.count({
        where: { status: ListingStatus.ACTIVE, publishedAt: { gte: today } },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.report.count({ where: { status: ReportStatus.PENDING } }),
      this.prisma.conversation.count(),
    ]);

    let search: { totalDocuments: number; isIndexing: boolean } | null = null;
    try {
      const meiliStats = await this.meili.client
        .index(LISTINGS_INDEX)
        .getStats();
      search = {
        totalDocuments: meiliStats.numberOfDocuments,
        isIndexing: meiliStats.isIndexing,
      };
    } catch {
      // Meilisearch unavailable — dashboard still functional without search stats.
    }

    return {
      listings: {
        active: listingsActive,
        pendingReview: listingsPendingReview,
        publishedToday: listingsPublishedToday,
      },
      users: {
        total: usersTotal,
        newToday: usersNewToday,
      },
      moderation: {
        reportsPending,
      },
      conversations: {
        total: conversationsTotal,
      },
      search,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

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
      select: { id: true, name: true, email: true, slug: true, role: true, status: true },
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
