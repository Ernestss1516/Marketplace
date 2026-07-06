import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Banner, BannerPlacement, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ListBannersDto } from './dto/list-banners.dto';

type BannerStatus = 'upcoming' | 'live' | 'ended';

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * GET /banners?placement=... (público, sin guard — la home es pública).
   * A diferencia de Campaign, aquí NO hay validación de no-solapamiento:
   * varios banners activos en la misma ubicación conviven sin ambigüedad (son
   * solo avisos, no dinero). Devuelve el array completo, no uno solo.
   */
  async getActiveBanners(placement: BannerPlacement): Promise<Banner[]> {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        placements: { has: placement },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — H8 Bloque D fase 4. Sin lógica de concurrencia (presentación,
  // sin dinero) — mismo patrón de AuditLog/status derivado que Campaign/Coupon.
  // ---------------------------------------------------------------------------

  async list(dto: ListBannersDto) {
    const { placement, active, page = 1, perPage = 25 } = dto;

    const where: Prisma.BannerWhereInput = {
      ...(placement && { placements: { has: placement } }),
      ...(active !== undefined && { active }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.banner.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.banner.count({ where }),
    ]);

    const now = new Date();
    const withStatus = items.map((b) => ({ ...b, status: this.deriveStatus(b, now) }));

    return { items: withStatus, total, page, perPage };
  }

  async create(dto: CreateBannerDto, actorId: string, ip?: string): Promise<Banner> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.banner.create({
        data: {
          title: dto.title,
          text: dto.text,
          linkUrl: dto.linkUrl ?? null,
          linkText: dto.linkText ?? null,
          placements: dto.placements,
          variant: dto.variant,
          shareable: dto.shareable ?? false,
          shareText: dto.shareText ?? null,
          active: dto.active ?? true,
          startsAt,
          endsAt,
        },
      });

      await this.auditLog.log(
        {
          action: 'BANNER_CREATE',
          actorId,
          resourceType: 'Banner',
          resourceId: created.id,
          after: this.snapshot(created) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return created;
    });
  }

  async update(id: string, dto: UpdateBannerDto, actorId: string, ip?: string): Promise<Banner> {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner no encontrado');

    const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    if (nextEndsAt <= nextStartsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.banner.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.text !== undefined && { text: dto.text }),
          ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl }),
          ...(dto.linkText !== undefined && { linkText: dto.linkText }),
          ...(dto.placements !== undefined && { placements: dto.placements }),
          ...(dto.variant !== undefined && { variant: dto.variant }),
          ...(dto.shareable !== undefined && { shareable: dto.shareable }),
          ...(dto.shareText !== undefined && { shareText: dto.shareText }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.startsAt !== undefined && { startsAt: nextStartsAt }),
          ...(dto.endsAt !== undefined && { endsAt: nextEndsAt }),
        },
      });

      let action = 'BANNER_EDIT';
      if (dto.active === true && !existing.active) action = 'BANNER_ACTIVATE';
      else if (dto.active === false && existing.active) action = 'BANNER_DEACTIVATE';

      await this.auditLog.log(
        {
          action,
          actorId,
          resourceType: 'Banner',
          resourceId: id,
          before: this.snapshot(existing) as unknown as Prisma.InputJsonValue,
          after: this.snapshot(updated) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private deriveStatus(banner: Banner, now: Date): BannerStatus {
    if (now < banner.startsAt) return 'upcoming';
    if (now > banner.endsAt) return 'ended';
    return 'live';
  }

  private snapshot(banner: Banner) {
    return {
      title: banner.title,
      text: banner.text,
      linkUrl: banner.linkUrl,
      linkText: banner.linkText,
      placements: banner.placements,
      variant: banner.variant,
      shareable: banner.shareable,
      shareText: banner.shareText,
      active: banner.active,
      startsAt: banner.startsAt.toISOString(),
      endsAt: banner.endsAt.toISOString(),
    };
  }
}
