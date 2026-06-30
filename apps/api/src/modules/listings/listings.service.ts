import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { EntitlementType, Prisma } from '@prisma/client';
import type { Listing, ListingStatus, PriceType } from '@prisma/client';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ExpirationService } from '../expiration/expiration.service';
import { EntitlementService } from '../billing/entitlement.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { BadWordService } from '../moderation/bad-word.service';
import { AttributeField, resolveEffectiveSchema } from '../categories/category.types';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';

const CACHE_TTL = 60 * 5;
const cacheKey = (slug: string) => `listing:${slug}`;

const LISTING_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: { order: 'asc' as const } },
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true } },
};

const SELECT_SUMMARY = {
  id: true,
  title: true,
  slug: true,
  price: true,
  currency: true,
  priceType: true,
  city: true,
  province: true,
  status: true,
  publishedAt: true,
  expiresAt: true,
  bumpedAt: true,
  attributes: true,
  category: { select: { slug: true } },
  images: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
} as const;

type SummaryDbRow = {
  id: string;
  title: string;
  slug: string;
  price: Prisma.Decimal;
  currency: string;
  priceType: PriceType;
  city: string | null;
  province: string | null;
  status: ListingStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  bumpedAt: Date | null;
  attributes: Prisma.JsonValue;
  category: { slug: string };
  images: { url: string }[];
};

interface AttributeSchemaEntry {
  name: string;
  required?: boolean;
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    private readonly geocodingService: GeocodingService,
    private readonly badWordService: BadWordService,
    private readonly entitlementService: EntitlementService,
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { attributeSchema: true, parent: { select: { attributeSchema: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    const effectiveSchema = resolveEffectiveSchema(
      (category.attributeSchema as unknown as AttributeField[]) ?? [],
      (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [],
    );
    this.validateAttributes(dto.attributes ?? {}, effectiveSchema);

    const slug = this.buildSlug(dto.title);

    // Geocode from text location if the caller did not provide explicit coords.
    // The call has a built-in 1.5 s timeout and returns null on any failure,
    // so a slow or unavailable geocoding service never blocks publication.
    let latitude = dto.latitude;
    let longitude = dto.longitude;
    if (latitude == null || longitude == null) {
      const coords = await this.geocodingService.geocode(
        dto.city,
        dto.province,
        dto.postalCode,
      );
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lng;
      }
    }

    const listing = await this.prisma.listing.create({
      data: {
        title: dto.title,
        slug,
        description: dto.description,
        price: dto.price,
        currency: dto.currency ?? 'EUR',
        type: dto.type,
        condition: dto.condition,
        priceType: dto.priceType,
        attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
        city: dto.city,
        province: dto.province,
        postalCode: dto.postalCode,
        latitude,
        longitude,
        sellerId,
        categoryId: dto.categoryId,
      },
    });

    if (dto.imageIds?.length) {
      await this.linkImages(listing.id, sellerId, dto.imageIds);
    }

    return listing;
  }

  async update(id: string, userId: string, dto: UpdateListingDto): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);

    if (dto.categoryId !== undefined || dto.attributes !== undefined) {
      const catId = dto.categoryId ?? existing.categoryId;
      const category = await this.prisma.category.findUnique({
        where: { id: catId },
        select: { attributeSchema: true, parent: { select: { attributeSchema: true } } },
      });
      if (!category) throw new NotFoundException('Category not found');
      const effectiveSchema = resolveEffectiveSchema(
        (category.attributeSchema as unknown as AttributeField[]) ?? [],
        (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [],
      );
      const mergedAttrs = {
        ...(existing.attributes as Record<string, unknown>),
        ...(dto.attributes ?? {}),
      };
      this.validateAttributes(mergedAttrs, effectiveSchema);
    }

    const { imageIds, ...fields } = dto;

    // Re-geocode when location text changed and no explicit coords were provided.
    // Explicit lat/lng in the DTO always take priority over geocoding.
    const locationChanged =
      fields.city !== undefined ||
      fields.province !== undefined ||
      fields.postalCode !== undefined;
    const coordsExplicit =
      fields.latitude !== undefined && fields.longitude !== undefined;

    let coordUpdate: { latitude?: number; longitude?: number } = {};
    if (coordsExplicit) {
      coordUpdate = { latitude: fields.latitude, longitude: fields.longitude };
    } else if (locationChanged) {
      const city = fields.city ?? existing.city ?? '';
      const province = fields.province ?? existing.province ?? '';
      const postalCode =
        fields.postalCode !== undefined
          ? fields.postalCode
          : (existing.postalCode ?? undefined);
      const coords = await this.geocodingService.geocode(city, province, postalCode);
      if (coords) coordUpdate = { latitude: coords.lat, longitude: coords.lng };
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.price !== undefined && { price: fields.price }),
        ...(fields.currency !== undefined && { currency: fields.currency }),
        ...(fields.type !== undefined && { type: fields.type }),
        ...(fields.condition !== undefined && { condition: fields.condition }),
        ...(fields.priceType !== undefined && { priceType: fields.priceType }),
        ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
        ...(fields.attributes !== undefined && { attributes: fields.attributes as object }),
        ...(fields.city !== undefined && { city: fields.city }),
        ...(fields.province !== undefined && { province: fields.province }),
        ...(fields.postalCode !== undefined && { postalCode: fields.postalCode }),
        ...coordUpdate,
      },
    });

    if (imageIds !== undefined) {
      await this.prisma.listingImage.updateMany({
        where: { listingId: id, id: { notIn: imageIds } },
        data: { listingId: null, order: 0 },
      });
      if (imageIds.length) {
        await this.linkImages(id, userId, imageIds);
      }
    }

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  async publish(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden publicar anuncios en estado DRAFT');
    }

    // Content filter — if the list is empty or service fails, targetStatus stays
    // ACTIVE. Moderation is a helper layer and must never block publication.
    let targetStatus: 'ACTIVE' | 'PENDING_REVIEW' = 'ACTIVE';
    try {
      const flagged = await this.badWordService.hasBadWords(
        existing.title,
        existing.description,
      );
      if (flagged) targetStatus = 'PENDING_REVIEW';
    } catch (_err) {
      // Silent fallback — publication continues normally.
    }

    // RF.7: enforce active listing limit before activating.
    if (targetStatus === 'ACTIVE') {
      await this.checkActiveListingLimit(userId);
    }

    const publishedAt = existing.publishedAt ?? new Date();
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: targetStatus,
        publishedAt,
        // Only ACTIVE listings get an expiry. PENDING_REVIEW gets it on approval.
        ...(targetStatus === 'ACTIVE' && {
          expiresAt: ExpirationService.expiresAt(publishedAt),
        }),
      },
    });

    if (targetStatus === 'ACTIVE') {
      await this.invalidateAndReindex(listing.slug, id);
    }

    return listing;
  }

  async renew(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'ACTIVE' && existing.status !== 'EXPIRED') {
      throw new BadRequestException(
        'Solo se pueden renovar anuncios en estado ACTIVE o EXPIRED',
      );
    }

    // RF.7: renewing brings the listing back to ACTIVE — counts against the limit
    // the same as publishing (Opción A). A slot is a slot regardless of origin.
    await this.checkActiveListingLimit(userId);

    const now = new Date();
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        // Preserve the original publishedAt: resetting it would be a free bump that
        // defeats the paid bump mechanic (RF.6) and gives wrong datePublished for SEO.
        // Only extend the expiry window from now.
        expiresAt: ExpirationService.expiresAt(now),
      },
    });

    await this.invalidateAndReindex(listing.slug, id);
    return listing;
  }

  async reserve(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Solo se pueden reservar anuncios en estado ACTIVE');
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'RESERVED' },
    });

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  async markAsSold(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'SOLD' },
    });
    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  async findMineById(id: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    return listing;
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.assertOwnership(id, userId);
    await this.prisma.listing.delete({ where: { id } });
    await this.redis.client.del(cacheKey(existing.slug));
    await this.indexingQueue.add('remove', { listingId: id });
  }

  async findBySlug(slug: string) {
    const raw = await this.redis.client.get(cacheKey(slug));
    let listingData: object & { id: string };

    if (raw) {
      this.incrementViews(slug);
      listingData = JSON.parse(raw) as object & { id: string };
    } else {
      const listing = await this.prisma.listing.findUnique({
        where: { slug },
        include: LISTING_INCLUDE,
      });
      if (!listing || listing.status !== 'ACTIVE') {
        throw new NotFoundException('Anuncio no encontrado');
      }
      await this.redis.client.setex(cacheKey(slug), CACHE_TTL, JSON.stringify(listing));
      this.incrementViews(slug);
      listingData = listing;
    }

    // Always computed fresh — not cached — so router.refresh() reflects featuring instantly.
    const now = new Date();
    const featuredEntitlement = await this.prisma.entitlement.findFirst({
      where: {
        listingId: listingData.id,
        type: EntitlementType.FEATURED_LISTING,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { expiresAt: true },
      orderBy: { expiresAt: 'desc' },
    });

    return { ...listingData, featuredUntil: featuredEntitlement?.expiresAt ?? null };
  }

  async findByCategory(
    categorySlug: string,
    page = 1,
    perPage = 24,
    sort = 'publishedAt:desc',
  ) {
    const [sortField, sortDir] = sort.split(':');
    const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy =
      sortField === 'price' ? { price: dir } : { publishedAt: dir };

    const where = {
      status: 'ACTIVE' as const,
      category: { slug: categorySlug },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map((r) => this.toSummary(r)), total, page, perPage };
  }

  async findBySellerSlug(sellerSlug: string, page = 1, perPage = 24) {
    const where = { status: 'ACTIVE' as const, seller: { slug: sellerSlug } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map((r) => this.toSummary(r)), total, page, perPage };
  }

  async findRecent(page = 1, perPage = 8) {
    const where = { status: 'ACTIVE' as const };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map((r) => this.toSummary(r)), total, page, perPage };
  }

  async findMine(userId: string, query: MyListingsQueryDto) {
    const { status, page = 1, perPage = 24 } = query;
    const where = {
      sellerId: userId,
      ...(status !== undefined ? { status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);

    // Batch query for active FEATURED_LISTING entitlements — one query for all listings, no N+1.
    const featuredMap = new Map<string, string>();
    if (rows.length > 0) {
      const now = new Date();
      const entitlements = await this.prisma.entitlement.findMany({
        where: {
          listingId: { in: rows.map((r) => r.id) },
          type: 'FEATURED_LISTING',
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { listingId: true, expiresAt: true },
      });
      for (const e of entitlements) {
        if (e.listingId && e.expiresAt) {
          featuredMap.set(e.listingId, e.expiresAt.toISOString());
        }
      }
    }

    return {
      items: rows.map((r) => ({
        ...this.toSummary(r),
        featuredUntil: featuredMap.get(r.id) ?? null,
      })),
      total,
      page,
      perPage,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toSummary({ images, bumpedAt, attributes, category, ...rest }: SummaryDbRow) {
    return {
      ...rest,
      thumbnailUrl: images[0]?.url ?? undefined,
      bumpedAt: bumpedAt?.toISOString() ?? undefined,
      categorySlug: category.slug,
      attributes: (attributes as Record<string, unknown>) ?? {},
    };
  }

  private async assertOwnership(id: string, userId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    return listing;
  }

  private async invalidateAndReindex(slug: string, id: string): Promise<void> {
    await this.redis.client.del(cacheKey(slug));
    await this.indexingQueue.add('index', { listingId: id });
  }

  private incrementViews(slug: string): void {
    this.prisma.listing
      .update({ where: { slug }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  private buildSlug(title: string): string {
    const base = title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  private validateAttributes(
    attributes: Record<string, unknown>,
    schema: unknown,
  ): void {
    const entries = (Array.isArray(schema) ? schema : []) as AttributeSchemaEntry[];
    const missing = entries
      .filter((e) => e.required && !Object.prototype.hasOwnProperty.call(attributes, e.name))
      .map((e) => e.name);
    if (missing.length) {
      throw new UnprocessableEntityException(
        `Atributos requeridos faltantes: ${missing.join(', ')}`,
      );
    }
  }

  private async checkActiveListingLimit(userId: string): Promise<void> {
    const isPro = await this.entitlementService.isProActive(userId);
    const settingKey = isPro ? 'proActiveListingLimit' : 'freeActiveListingLimit';
    const defaultLimit = isPro ? 20 : 5;

    const setting = await this.prisma.setting.findUnique({ where: { key: settingKey } });
    const limit = setting ? Number(setting.value) : defaultLimit;

    const activeCount = await this.prisma.listing.count({
      where: { sellerId: userId, status: 'ACTIVE' },
    });

    if (activeCount >= limit) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limit} anuncios activos de tu plan`,
      );
    }
  }

  private async linkImages(
    listingId: string,
    userId: string,
    imageIds: string[],
  ): Promise<void> {
    const images = await this.prisma.listingImage.findMany({
      where: { id: { in: imageIds } },
      select: { id: true, uploadedById: true, listingId: true },
    });

    const notFound = imageIds.filter((imgId) => !images.some((img) => img.id === imgId));
    if (notFound.length) {
      throw new UnprocessableEntityException(
        `Imágenes no encontradas: ${notFound.join(', ')}`,
      );
    }

    for (const img of images) {
      if (img.uploadedById !== userId) {
        throw new UnprocessableEntityException(
          `La imagen ${img.id} no pertenece al usuario`,
        );
      }
      if (img.listingId !== null && img.listingId !== listingId) {
        throw new UnprocessableEntityException(
          `La imagen ${img.id} ya está vinculada a otro anuncio`,
        );
      }
    }

    await Promise.all(
      imageIds.map((imgId, order) =>
        this.prisma.listingImage.update({
          where: { id: imgId },
          data: { listingId, order },
        }),
      ),
    );
  }
}
