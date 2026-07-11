import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, SponsoredAd } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { R2Service } from '../../infra/r2/r2.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MIME_TO_EXT } from '../media/media.service';
import { CreateSponsoredAdDto } from './dto/create-sponsored-ad.dto';
import { UpdateSponsoredAdDto } from './dto/update-sponsored-ad.dto';
import { ListSponsoredAdsDto } from './dto/list-sponsored-ads.dto';

type SponsoredAdStatus = 'upcoming' | 'live' | 'ended';

export interface SponsoredAdPublic {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  targetUrl: string;
}

// 5 min — el admin gestiona esto a mano, así que un pequeño retraso en
// reflejar un cambio es aceptable a cambio de no tocar Postgres en cada
// búsqueda de categoría (ver apps/api/CLAUDE.md, invariante de búsqueda).
const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'sponsored-ad:search:';

@Injectable()
export class SponsoredAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly r2: R2Service,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Búsqueda (H6.6) — resuelve el patrocinado a inyectar para una categoría,
  // cacheado en Redis. Ver search.controller.ts (solo se llama en página 1).
  // ---------------------------------------------------------------------------

  async resolveForSearch(categorySlug: string): Promise<SponsoredAdPublic | null> {
    const cacheKey = CACHE_PREFIX + categorySlug;
    const cached = await this.redis.client.get(cacheKey);
    if (cached !== null) {
      return cached === 'null' ? null : (JSON.parse(cached) as SponsoredAdPublic);
    }

    const category = await this.prisma.category.findUnique({
      where: { slug: categorySlug },
      select: { id: true, parentId: true },
    });

    const ad = category ? await this.findActiveAd(category.id, category.parentId) : null;

    await this.redis.client.set(cacheKey, ad ? JSON.stringify(ad) : 'null', 'EX', CACHE_TTL_SECONDS);
    return ad;
  }

  /**
   * "Categoría o hijas" (2 niveles, mismo límite que categoryPath en
   * search.service.ts): un patrocinado vinculado a la categoría buscada O a su
   * padre es candidato. No al revés — un patrocinado de una hoja no aparece al
   * buscar por el padre.
   */
  private async findActiveAd(categoryId: string, parentId: string | null): Promise<SponsoredAdPublic | null> {
    const categoryIds = parentId ? [categoryId, parentId] : [categoryId];
    const now = new Date();
    return this.prisma.sponsoredAd.findFirst({
      where: {
        categoryId: { in: categoryIds },
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, description: true, imageUrl: true, targetUrl: true },
    });
  }

  /**
   * Invalida el/los slug(s) de categoría afectados por una mutación de
   * SponsoredAd: el propio slug siempre, y el de cada hijo si la categoría
   * tiene hijos (porque un patrocinado del padre es candidato en sus búsquedas).
   */
  private async invalidateCacheForCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { slug: true, children: { select: { slug: true } } },
    });
    if (!category) return;

    const keys = [category.slug, ...category.children.map((c) => c.slug)].map((s) => CACHE_PREFIX + s);
    if (keys.length) await this.redis.client.del(...keys);
  }

  // ---------------------------------------------------------------------------
  // Subida de imagen — molde uploadAvatar (media.service.ts): URL-only, NO
  // toca ListingImage. El admin sube primero, luego crea/edita con la URL.
  // ---------------------------------------------------------------------------

  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.');

    const key = `sponsored/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return { url: this.r2.getPublicUrl(key) };
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — molde Banner (H8 Bloque D fase 4): AuditLog, status derivado,
  // sin DELETE (solo desactivar).
  // ---------------------------------------------------------------------------

  async list(dto: ListSponsoredAdsDto) {
    const { categoryId, active, page = 1, perPage = 25 } = dto;

    const where: Prisma.SponsoredAdWhereInput = {
      ...(categoryId && { categoryId }),
      ...(active !== undefined && { active }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sponsoredAd.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { category: { select: { name: true, slug: true } } },
      }),
      this.prisma.sponsoredAd.count({ where }),
    ]);

    const now = new Date();
    const withStatus = items.map((item) => ({ ...item, status: this.deriveStatus(item, now) }));

    return { items: withStatus, total, page, perPage };
  }

  async create(dto: CreateSponsoredAdDto, actorId: string, ip?: string): Promise<SponsoredAd> {
    this.assertValidWindow(dto.startsAt, dto.endsAt);

    const created = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Categoría no encontrada');

      const ad = await tx.sponsoredAd.create({
        data: {
          imageUrl: dto.imageUrl,
          title: dto.title,
          description: dto.description,
          targetUrl: dto.targetUrl,
          categoryId: dto.categoryId,
          order: dto.order ?? 0,
          active: dto.active ?? true,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        },
      });

      await this.auditLog.log(
        {
          action: 'SPONSORED_AD_CREATE',
          actorId,
          resourceType: 'SponsoredAd',
          resourceId: ad.id,
          after: this.snapshot(ad) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return ad;
    });

    await this.invalidateCacheForCategory(created.categoryId);
    return created;
  }

  async update(id: string, dto: UpdateSponsoredAdDto, actorId: string, ip?: string): Promise<SponsoredAd> {
    const existing = await this.prisma.sponsoredAd.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Patrocinado no encontrado');

    const nextStartsAt = dto.startsAt !== undefined ? (dto.startsAt ? new Date(dto.startsAt) : null) : existing.startsAt;
    const nextEndsAt = dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : existing.endsAt;
    this.assertValidWindow(nextStartsAt?.toISOString(), nextEndsAt?.toISOString());

    if (dto.categoryId !== undefined && dto.categoryId !== existing.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Categoría no encontrada');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.sponsoredAd.update({
        where: { id },
        data: {
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.targetUrl !== undefined && { targetUrl: dto.targetUrl }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.startsAt !== undefined && { startsAt: nextStartsAt }),
          ...(dto.endsAt !== undefined && { endsAt: nextEndsAt }),
        },
      });

      let action = 'SPONSORED_AD_EDIT';
      if (dto.active === true && !existing.active) action = 'SPONSORED_AD_ACTIVATE';
      else if (dto.active === false && existing.active) action = 'SPONSORED_AD_DEACTIVATE';

      await this.auditLog.log(
        {
          action,
          actorId,
          resourceType: 'SponsoredAd',
          resourceId: id,
          before: this.snapshot(existing) as unknown as Prisma.InputJsonValue,
          after: this.snapshot(result) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return result;
    });

    await this.invalidateCacheForCategory(existing.categoryId);
    if (updated.categoryId !== existing.categoryId) {
      await this.invalidateCacheForCategory(updated.categoryId);
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertValidWindow(startsAt?: string | null, endsAt?: string | null): void {
    if (!startsAt || !endsAt) return;
    if (new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }
  }

  private deriveStatus(ad: SponsoredAd, now: Date): SponsoredAdStatus {
    if (ad.startsAt && now < ad.startsAt) return 'upcoming';
    if (ad.endsAt && now > ad.endsAt) return 'ended';
    return 'live';
  }

  private snapshot(ad: SponsoredAd) {
    return {
      imageUrl: ad.imageUrl,
      title: ad.title,
      description: ad.description,
      targetUrl: ad.targetUrl,
      categoryId: ad.categoryId,
      order: ad.order,
      active: ad.active,
      startsAt: ad.startsAt?.toISOString() ?? null,
      endsAt: ad.endsAt?.toISOString() ?? null,
    };
  }
}
