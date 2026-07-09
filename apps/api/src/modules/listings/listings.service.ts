import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { isP2002 } from '../../common/prisma/is-p2002';
import { ExpirationService } from '../expiration/expiration.service';
import { EntitlementService } from '../billing/entitlement.service';
import { BadWordService } from '../moderation/bad-word.service';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveLinkedOptions,
  filterSchemaByType,
  isListingTypeAllowed,
} from '../categories/category.types';
import type { ListingTypePolicy } from '@prisma/client';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';

/** Cap on slug-collision retries — high enough that exhausting it means something is very wrong, not bad luck. */
const MAX_SLUG_ATTEMPTS = 5;

const CACHE_TTL = 60 * 5;
const cacheKey = (slug: string) => `listing:${slug}`;

const LISTING_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: { order: 'asc' as const } },
  // trusted: H8 Bloque E — "Vendedor de confianza" en la ficha del anuncio (SellerCard).
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true, trusted: true } },
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
  viewCount: true,
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
  viewCount: number;
  category: { slug: string };
  images: { url: string }[];
};

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    private readonly badWordService: BadWordService,
    private readonly entitlementService: EntitlementService,
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: {
        attributeSchema: true,
        allowedListingType: true,
        parent: { select: { attributeSchema: true, allowedListingType: true } },
      },
    });
    if (!category) throw new NotFoundException('Category not found');
    const effectiveSchema = resolveEffectiveSchema(
      (category.attributeSchema as unknown as AttributeField[]) ?? [],
      (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [],
    );
    // required se exige solo entre los campos aplicables al tipo del anuncio —
    // igual que el wizard, que nunca envía un campo appliesTo-restringido al
    // otro tipo. Sin este filtro, un required de un tipo bloquearía SIEMPRE
    // los anuncios del tipo contrario (RÁFAGA 5, bug real encontrado en verificación).
    const applicableSchema = filterSchemaByType(effectiveSchema, dto.type);
    // create() valida COMPLETO — no hay "existing" con el que calcular un delta.
    this.validateRequired(dto.attributes ?? {}, applicableSchema);
    this.validateAttributeValues(dto.attributes ?? {}, applicableSchema);
    this.validateLinkedSelects(dto.attributes ?? {}, applicableSchema);
    this.validateListingTypeAllowed(
      dto.type,
      category.allowedListingType,
      category.parent?.allowedListingType,
    );

    const listing = await this.createWithUniqueSlug(dto.title, {
      title: dto.title,
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
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      sellerId,
      categoryId: dto.categoryId,
    });

    if (dto.imageIds?.length) {
      await this.linkImages(listing.id, sellerId, dto.imageIds);
    }

    // Geocode in background via BullMQ — coordinates are not needed to publish.
    // This avoids blocking the HTTP response on an external service (Nominatim).
    if (dto.latitude == null && dto.longitude == null) {
      await this.indexingQueue.add('geocode', { listingId: listing.id });
    }

    return listing;
  }

  async update(id: string, userId: string, dto: UpdateListingDto): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);

    if (dto.categoryId !== undefined || dto.attributes !== undefined) {
      const catId = dto.categoryId ?? existing.categoryId;
      const category = await this.prisma.category.findUnique({
        where: { id: catId },
        select: {
          attributeSchema: true,
          allowedListingType: true,
          parent: { select: { attributeSchema: true, allowedListingType: true } },
        },
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
      // type es inmutable — se filtra por el tipo YA fijado del anuncio, igual que en create().
      const applicableSchema = filterSchemaByType(effectiveSchema, existing.type);
      // required se exige siempre sobre el bag COMPLETO (invariante de completitud
      // del anuncio, no depende de qué campo tocó esta edición en concreto).
      this.validateRequired(mergedAttrs, applicableSchema);
      // El resto (opciones/tipo/claves desconocidas + el guard de vinculados) se
      // acota al DELTA: valores ya guardados que el usuario ni toca se toleran
      // (grandfathering por construcción) — así una edición trivial (p. ej. solo
      // el precio) de un anuncio con datos sucios preexistentes no rompe.
      const delta = this.computeAttributesDelta(
        (existing.attributes as Record<string, unknown>) ?? {},
        dto.attributes ?? {},
      );
      const deltaAttrs: Record<string, unknown> = {};
      for (const key of delta) deltaAttrs[key] = mergedAttrs[key];
      this.validateAttributeValues(deltaAttrs, applicableSchema);
      this.validateLinkedSelects(mergedAttrs, applicableSchema, delta);

      // type is immutable (not on UpdateListingDto) — but categoryId can still change,
      // so a listing's fixed type must stay allowed by whatever category it moves into.
      if (dto.categoryId !== undefined) {
        this.validateListingTypeAllowed(
          existing.type,
          category.allowedListingType,
          category.parent?.allowedListingType,
        );
      }
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
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.price !== undefined && { price: fields.price }),
        ...(fields.currency !== undefined && { currency: fields.currency }),
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

    // Clear cache immediately, then enqueue exactly one indexing-affecting job.
    // When the address changed without explicit coords, the 'geocode' job
    // reindexes itself once it has resolved (or given up on) the new
    // coordinates (see handleGeocode) — it is NOT paired with a separate
    // 'index' job here anymore. Two jobs for the same listingId with no
    // ordering guarantee beyond incidental queue concurrency=1 previously
    // raced: enqueuing only one job per update removes that race regardless
    // of @Processor(QUEUE_INDEXING) concurrency.
    await this.redis.client.del(cacheKey(existing.slug));
    if (locationChanged && !coordsExplicit) {
      await this.indexingQueue.add('geocode', { listingId: id });
    } else {
      await this.indexingQueue.add('index', { listingId: id });
    }
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
    // H8 Bloque C2 — cifras básicas de estadísticas (vistas + me gusta) por anuncio,
    // igual patrón: una sola query batch, no N+1 por card.
    const favoritesCountMap = new Map<string, number>();
    if (rows.length > 0) {
      const now = new Date();
      const ids = rows.map((r) => r.id);
      const [entitlements, favoriteGroups] = await Promise.all([
        this.prisma.entitlement.findMany({
          where: {
            listingId: { in: ids },
            type: 'FEATURED_LISTING',
            revokedAt: null,
            expiresAt: { gt: now },
          },
          select: { listingId: true, expiresAt: true },
        }),
        this.prisma.favorite.groupBy({
          by: ['listingId'],
          where: { listingId: { in: ids } },
          _count: { _all: true },
        }),
      ]);
      for (const e of entitlements) {
        if (e.listingId && e.expiresAt) {
          featuredMap.set(e.listingId, e.expiresAt.toISOString());
        }
      }
      for (const g of favoriteGroups) {
        favoritesCountMap.set(g.listingId, g._count._all);
      }
    }

    return {
      items: rows.map((r) => ({
        ...this.toSummary(r),
        featuredUntil: featuredMap.get(r.id) ?? null,
        favoritesCount: favoritesCountMap.get(r.id) ?? 0,
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

  // ---------------------------------------------------------------------------
  // H8 Bloque C1 — tracking de vistas (fuera de findBySlug, sortea la caché de
  // 5 min de la ficha porque el cliente llama a este endpoint en cada montaje,
  // venga el HTML de caché o no) + lectura de estadísticas.
  // ---------------------------------------------------------------------------

  private static readonly VIEW_DEDUP_TTL_SECONDS = 60 * 30;

  async trackView(slug: string, viewerId: string | null, visitorHash: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { slug },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    // El dueño viendo su propio anuncio nunca cuenta — ni siquiera marca dedup.
    if (viewerId && viewerId === listing.sellerId) return;

    const visitorKey = viewerId ? `user:${viewerId}` : `anon:${visitorHash}`;
    const dedupKey = `view:dedup:${listing.id}:${visitorKey}`;
    const accepted = await this.redis.client.set(
      dedupKey,
      '1',
      'EX',
      ListingsService.VIEW_DEDUP_TTL_SECONDS,
      'NX',
    );
    if (accepted !== 'OK') return; // recarga duplicada dentro de la ventana

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await Promise.all([
      this.prisma.listing.update({
        where: { id: listing.id },
        data: { viewCount: { increment: 1 } },
      }),
      this.prisma.listingViewDaily.upsert({
        where: { listingId_date: { listingId: listing.id, date: today } },
        create: { listingId: listing.id, date: today, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ]);
  }

  /** Estadísticas de un anuncio propio. Básicas para todos; enriquecidas si el dueño es Pro. */
  async getMineStats(id: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, viewCount: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }

    const favoritesCount = await this.prisma.favorite.count({ where: { listingId: id } });
    const isPro = await this.entitlementService.isProActive(userId);
    if (!isPro) {
      return { viewCount: listing.viewCount, favoritesCount };
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    const dailyRows = await this.prisma.listingViewDaily.findMany({
      where: { listingId: id, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, count: true },
    });

    return {
      viewCount: listing.viewCount,
      favoritesCount,
      dailyViews: dailyRows,
      likeRatio: listing.viewCount > 0 ? favoritesCount / listing.viewCount : 0,
    };
  }

  /** Agregado del vendedor (todos sus anuncios) — solo Pro. */
  async getMineStatsSummary(userId: string) {
    const isPro = await this.entitlementService.isProActive(userId);
    if (!isPro) {
      throw new ForbiddenException('Estadísticas agregadas disponibles solo para Pro');
    }

    const listings = await this.prisma.listing.findMany({
      where: { sellerId: userId },
      select: { id: true, viewCount: true },
    });
    const totalViews = listings.reduce((sum, l) => sum + l.viewCount, 0);
    const totalFavorites = await this.prisma.favorite.count({
      where: { listing: { sellerId: userId } },
    });
    const mostViewed = listings.reduce<{ id: string; viewCount: number } | null>(
      (max, l) => (max === null || l.viewCount > max.viewCount ? l : max),
      null,
    );

    return {
      totalViews,
      totalFavorites,
      mostViewedListingId: mostViewed?.id ?? null,
    };
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

  // The slug isn't user-chosen (it's derived from the title + a random hex
  // suffix), so a P2002 collision isn't a conflict for the user to resolve —
  // regenerate a fresh random suffix and retry, silently. Only surfaces to the
  // caller if MAX_SLUG_ATTEMPTS is exhausted, which at a 16.7M-value keyspace
  // means something is very wrong (not ordinary bad luck).
  private async createWithUniqueSlug(
    title: string,
    data: Omit<Prisma.ListingUncheckedCreateInput, 'slug'>,
  ): Promise<Listing> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.listing.create({
          data: { ...data, slug: this.buildSlug(title) },
        });
      } catch (err) {
        if (!isP2002(err)) throw err;
        if (attempt < MAX_SLUG_ATTEMPTS) continue;
        this.logger.error(`Slug generation exhausted ${MAX_SLUG_ATTEMPTS} attempts for title="${title}"`);
        throw new ConflictException({
          message: 'No se pudo generar un identificador único para el anuncio, inténtalo de nuevo',
          code: 'SLUG_GENERATION_FAILED',
        });
      }
    }
    // Unreachable: every loop iteration either returns or throws above.
    throw new ConflictException({
      message: 'No se pudo generar un identificador único para el anuncio, inténtalo de nuevo',
      code: 'SLUG_GENERATION_FAILED',
    });
  }

  private validateRequired(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
  ): void {
    const missing = schema
      .filter((f) => f.required && !Object.prototype.hasOwnProperty.call(attributes, f.name))
      .map((f) => f.name);
    if (missing.length) {
      throw new UnprocessableEntityException(
        `Atributos requeridos faltantes: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Refuerzo de validación (cierra la asimetría con validateLinkedSelects,
   * que ya valida sus valores desde R5): claves desconocidas, opciones de
   * select PLANO, y tipo de dato. Los selects vinculados (`dependsOn`) se
   * saltan aquí — los valida `validateLinkedSelects`. Presencia/required-ness
   * es trabajo de `validateRequired`, no de esta función.
   *
   * `attributes` puede ser el bag completo (create) o solo el delta (update)
   * — el caller decide qué subconjunto pasar; esta función valida lo que
   * recibe sin distinguir el origen.
   */
  private validateAttributeValues(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
  ): void {
    const byName = new Map(schema.map((f) => [f.name, f]));

    const unknown = Object.keys(attributes).filter((k) => !byName.has(k));
    if (unknown.length) {
      throw new UnprocessableEntityException(
        `Atributos no reconocidos: ${unknown.join(', ')}`,
      );
    }

    for (const field of schema) {
      if (field.dependsOn) continue; // vinculados: los valida validateLinkedSelects
      if (!(field.name in attributes)) continue;
      const value = attributes[field.name];
      if (value === null || value === undefined || value === '') continue;

      if (field.type === 'select') {
        if (!(field.options ?? []).includes(String(value))) {
          throw new UnprocessableEntityException(
            `"${value}" no es una opción válida de "${field.label}".`,
          );
        }
      } else if (field.type === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        if (typeof value === 'boolean' || value === '' || Number.isNaN(n)) {
          throw new UnprocessableEntityException(`"${field.label}" debe ser un número.`);
        }
      } else if (field.type === 'boolean') {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          throw new UnprocessableEntityException(`"${field.label}" debe ser verdadero/falso.`);
        }
      }
      // text: cualquier string vale, sin refuerzo adicional.
    }
  }

  /**
   * Una clave cuenta como "delta" (cambiada en ESTA petición) si su valor en
   * el payload entrante difiere del ya guardado, o es una clave nueva. Una
   * clave reenviada con el MISMO valor no es delta — así update() puede
   * recibir el bag completo (como hace EditarWizard, incondicionalmente) sin
   * que eso re-valide datos preexistentes que el usuario ni toca.
   * JSON.stringify en vez de `===`: los 4 tipos de atributo son siempre
   * primitivos planos, nunca objetos/arrays anidados, así que es suficiente
   * y cubre null/undefined sin casos especiales.
   */
  private computeAttributesDelta(
    existingAttrs: Record<string, unknown>,
    incomingAttrs: Record<string, unknown>,
  ): Set<string> {
    const changed = new Set<string>();
    for (const [key, value] of Object.entries(incomingAttrs)) {
      if (
        !Object.prototype.hasOwnProperty.call(existingAttrs, key) ||
        JSON.stringify(existingAttrs[key]) !== JSON.stringify(value)
      ) {
        changed.add(key);
      }
    }
    return changed;
  }

  /**
   * Enforces linked selects (`AttributeField.dependsOn` / `optionsByParent`):
   * a dependent field's value must belong to its parent's currently-chosen
   * value. Deliberately asymmetric with `validateAttributeValues` — plain
   * attributes not present in the schema are tolerated, but a *linked* field
   * with a value must resolve against its parent within the SAME payload.
   * Only fields that actually carry a value are checked; presence/required-ness
   * is `validateRequired`'s job.
   *
   * `deltaKeys` — solo en update(): si ni el campo ni su padre (`dependsOn`)
   * cambiaron en esta petición, el par no se re-valida, aunque ya fuera
   * inválido (grandfathering, igual que `validateAttributeValues`). Ausente
   * en create() — ahí se valida siempre, no hay "existing" con el que
   * comparar. `attributes` sigue siendo el bag COMPLETO (fusionado) en
   * ambos casos: se necesita para resolver el valor ACTUAL del padre,
   * aunque no haya cambiado en esta petición.
   */
  private validateLinkedSelects(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
    deltaKeys?: Set<string>,
  ): void {
    for (const field of schema) {
      if (!field.dependsOn) continue;
      if (deltaKeys && !deltaKeys.has(field.name) && !deltaKeys.has(field.dependsOn)) continue;

      const rawValue = attributes[field.name];
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      const value = String(rawValue);

      const parentRaw = attributes[field.dependsOn];
      if (parentRaw === undefined || parentRaw === null || parentRaw === '') {
        const parentLabel =
          schema.find((f) => f.name === field.dependsOn)?.label ?? field.dependsOn;
        throw new UnprocessableEntityException(
          `"${field.label}" requiere seleccionar primero "${parentLabel}".`,
        );
      }

      const validOptions = resolveLinkedOptions(field, String(parentRaw));
      if (!validOptions.includes(value)) {
        throw new UnprocessableEntityException(
          `"${value}" no es una opción válida de "${field.label}" para el valor elegido.`,
        );
      }
    }
  }

  /**
   * Validates a listing's type against its category's effective ListingTypePolicy
   * (own + parent, same 2-level depth as resolveEffectiveSchema). Every existing
   * category defaults to BOTH, so this is a no-op until an admin restricts one.
   */
  private validateListingTypeAllowed(
    type: Listing['type'],
    ownPolicy: ListingTypePolicy,
    parentPolicy: ListingTypePolicy | undefined,
  ): void {
    const effective = resolveEffectivePolicy(ownPolicy, parentPolicy ?? 'BOTH');
    if (!isListingTypeAllowed(effective, type)) {
      throw new UnprocessableEntityException(
        `Esta categoría no admite anuncios de tipo ${type}.`,
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
