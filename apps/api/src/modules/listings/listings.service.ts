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
import { Prisma } from '@prisma/client';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';
import type { Listing } from '@prisma/client';

const CACHE_TTL = 60 * 5;
const cacheKey = (slug: string) => `listing:${slug}`;

const LISTING_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: { order: 'asc' as const } },
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true } },
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
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { attributeSchema: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    this.validateAttributes(dto.attributes ?? {}, category.attributeSchema);

    const slug = this.buildSlug(dto.title);

    const listing = await this.prisma.listing.create({
      data: {
        title: dto.title,
        slug,
        description: dto.description,
        price: dto.price,
        currency: dto.currency ?? 'EUR',
        type: dto.type,
        condition: dto.condition,
        attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
        city: dto.city,
        province: dto.province,
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
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
        select: { attributeSchema: true },
      });
      if (!category) throw new NotFoundException('Category not found');
      const mergedAttrs = {
        ...(existing.attributes as Record<string, unknown>),
        ...(dto.attributes ?? {}),
      };
      this.validateAttributes(mergedAttrs, category.attributeSchema);
    }

    const { imageIds, ...fields } = dto;

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.price !== undefined && { price: fields.price }),
        ...(fields.currency !== undefined && { currency: fields.currency }),
        ...(fields.type !== undefined && { type: fields.type }),
        ...(fields.condition !== undefined && { condition: fields.condition }),
        ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
        ...(fields.attributes !== undefined && { attributes: fields.attributes as object }),
        ...(fields.city !== undefined && { city: fields.city }),
        ...(fields.province !== undefined && { province: fields.province }),
        ...(fields.postalCode !== undefined && { postalCode: fields.postalCode }),
        ...(fields.latitude !== undefined && { latitude: fields.latitude }),
        ...(fields.longitude !== undefined && { longitude: fields.longitude }),
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

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'ACTIVE', publishedAt: existing.publishedAt ?? new Date() },
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

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.assertOwnership(id, userId);
    await this.prisma.listing.delete({ where: { id } });
    await this.redis.client.del(cacheKey(existing.slug));
    await this.indexingQueue.add('remove', { listingId: id });
  }

  async findBySlug(slug: string) {
    const raw = await this.redis.client.get(cacheKey(slug));
    if (raw) {
      this.incrementViews(slug);
      return JSON.parse(raw) as object;
    }

    const listing = await this.prisma.listing.findUnique({
      where: { slug },
      include: LISTING_INCLUDE,
    });
    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException('Anuncio no encontrado');
    }

    await this.redis.client.setex(cacheKey(slug), CACHE_TTL, JSON.stringify(listing));
    this.incrementViews(slug);
    return listing;
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  async findMine(userId: string, query: MyListingsQueryDto) {
    const { status, page = 1, perPage = 24 } = query;
    const where = {
      sellerId: userId,
      ...(status !== undefined ? { status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: {
          images: { orderBy: { order: 'asc' as const }, take: 1 },
          category: { select: { name: true, slug: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
