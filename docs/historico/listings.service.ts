// ============================================================================
//  modules/listings/listings.service.ts
//  CRUD de anuncios. Es el punto donde se coordinan las tres piezas de datos:
//
//    PostgreSQL (Prisma)  → fuente de verdad: se escribe y se lee aquí.
//    Meilisearch (BullMQ) → al crear/editar/publicar se ENCOLA el reindexado,
//                           para no acoplar la petición HTTP al motor de búsqueda.
//    Redis                → caché de la ficha de anuncio; se invalida al cambiar.
//
//  Requiere:  npm i @nestjs/bullmq bullmq
// ============================================================================

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import type { Listing } from '@prisma/client';

const CACHE_TTL_SECONDS = 60 * 5; // 5 min para la ficha de anuncio
const listingCacheKey = (slug: string) => `listing:${slug}`;

// Incluye lo que necesita el indexador (category + images) y la galería de la ficha.
const LISTING_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: { order: 'asc' as const } },
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true } },
};

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // Cola de indexado: el worker (indexing.processor.ts) consume estos jobs.
    @InjectQueue('indexing') private readonly indexingQueue: Queue,
  ) {}

  // --------------------------------------------------------------------------
  //  Crear un anuncio (nace como borrador).
  // --------------------------------------------------------------------------
  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
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
        attributes: dto.attributes ?? {},
        city: dto.city,
        province: dto.province,
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        sellerId,
        categoryId: dto.categoryId,
        // status queda en DRAFT por defecto (definido en el schema).
      },
    });

    // En DRAFT no se indexa todavía; se hará al publicar.
    return listing;
  }

  // --------------------------------------------------------------------------
  //  Ficha de anuncio por slug (lectura cacheada).
  // --------------------------------------------------------------------------
  async findBySlug(slug: string) {
    // 1) ¿Está en caché?
    const cached = await this.redis.get<object>(listingCacheKey(slug));
    if (cached) {
      this.incrementViews(slug); // fire-and-forget, no bloquea la respuesta
      return cached;
    }

    // 2) Miss: leer de Postgres (fuente de verdad).
    const listing = await this.prisma.listing.findUnique({
      where: { slug },
      include: LISTING_INCLUDE,
    });
    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException('Anuncio no encontrado');
    }

    // 3) Guardar en caché para próximas visitas.
    await this.redis.set(listingCacheKey(slug), listing, CACHE_TTL_SECONDS);
    this.incrementViews(slug);
    return listing;
  }

  // --------------------------------------------------------------------------
  //  Listado simple por categoría (paginado). Para búsqueda con texto/filtros
  //  se usa SearchService (Meilisearch); esto cubre el listado directo.
  // --------------------------------------------------------------------------
  async findByCategory(categorySlug: string, page = 1, perPage = 24) {
    const where = {
      status: 'ACTIVE' as const,
      category: { slug: categorySlug },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  // --------------------------------------------------------------------------
  //  Actualizar un anuncio (solo el propietario).
  // --------------------------------------------------------------------------
  async update(id: string, userId: string, dto: UpdateListingDto): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { ...dto },
    });

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  // --------------------------------------------------------------------------
  //  Publicar: pasa a revisión (o directo a ACTIVE si no hay moderación previa).
  // --------------------------------------------------------------------------
  async publish(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'ACTIVE', publishedAt: existing.publishedAt ?? new Date() },
    });

    await this.invalidateAndReindex(listing.slug, id);
    return listing;
  }

  // --------------------------------------------------------------------------
  //  Marcar como vendido (se retira de la búsqueda automáticamente al reindexar).
  // --------------------------------------------------------------------------
  async markAsSold(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'SOLD' },
    });
    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  // --------------------------------------------------------------------------
  //  Eliminar un anuncio.
  // --------------------------------------------------------------------------
  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.assertOwnership(id, userId);
    await this.prisma.listing.delete({ where: { id } });
    await this.redis.del(listingCacheKey(existing.slug));
    await this.indexingQueue.add('remove', { listingId: id });
  }

  // ==========================================================================
  //  Helpers privados
  // ==========================================================================

  /** Comprueba que el anuncio existe y pertenece al usuario. */
  private async assertOwnership(id: string, userId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    return listing;
  }

  /**
   * Invalida la caché de la ficha y encola el reindexado.
   * El worker recarga el anuncio fresco desde Postgres (con category e images)
   * y decide indexarlo o retirarlo según su estado.
   */
  private async invalidateAndReindex(slug: string, id: string): Promise<void> {
    await this.redis.del(listingCacheKey(slug));
    await this.indexingQueue.add('index', { listingId: id });
  }

  /** Incremento de visitas desacoplado de la respuesta (no debe ralentizar la ficha). */
  private incrementViews(slug: string): void {
    this.prisma.listing
      .update({ where: { slug }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  /** Slug amigable para SEO + sufijo aleatorio que garantiza unicidad. */
  private buildSlug(title: string): string {
    const base = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    const suffix = randomBytes(3).toString('hex'); // 6 caracteres
    return `${base}-${suffix}`;
  }
}
