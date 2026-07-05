import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

type CampaignStatus = 'upcoming' | 'live' | 'ended';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Consultado por RedsysService en el checkout. Derivado, sin caché — con la
  // restricción de no-solapamiento del mismo type, hay como mucho una fila.
  // ---------------------------------------------------------------------------

  async getActiveCreditBonusCampaign(): Promise<Campaign | null> {
    const now = new Date();
    return this.prisma.campaign.findFirst({
      where: {
        type: CampaignType.CREDIT_BONUS,
        active: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  async list(dto: ListCampaignsDto) {
    const { type, active, page = 1, perPage = 25 } = dto;

    const where: Prisma.CampaignWhereInput = {
      ...(type && { type }),
      ...(active !== undefined && { active }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const now = new Date();
    const withStatus = items.map((c) => ({ ...c, status: this.deriveStatus(c, now) }));

    return { items: withStatus, total, page, perPage };
  }

  async create(dto: CreateCampaignDto, actorId: string, ip?: string): Promise<Campaign> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }

    const active = dto.active ?? true;
    if (active) {
      await this.assertNoOverlap(dto.type, startsAt, endsAt);
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          name: dto.name,
          type: dto.type,
          active,
          startsAt,
          endsAt,
          params: dto.params as unknown as Prisma.InputJsonValue,
        },
      });

      await this.auditLog.log(
        {
          action: 'CAMPAIGN_CREATE',
          actorId,
          resourceType: 'Campaign',
          resourceId: created.id,
          after: this.snapshot(created) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return created;
    });
  }

  async update(id: string, dto: UpdateCampaignDto, actorId: string, ip?: string): Promise<Campaign> {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Campaña no encontrada');

    const nextActive = dto.active ?? existing.active;
    const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    if (nextEndsAt <= nextStartsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }

    // Re-validar solapamiento solo si el resultado deja la campaña active Y algo
    // relevante al solapamiento cambia (se activa, o se mueven las fechas).
    // Editar sin activar (o una campaña ya inactiva que sigue inactiva) no
    // necesita re-validar — nunca puede resolver como "vigente".
    const activationChanged = nextActive && !existing.active;
    const datesChanged = dto.startsAt !== undefined || dto.endsAt !== undefined;
    if (nextActive && (activationChanged || datesChanged)) {
      await this.assertNoOverlap(existing.type, nextStartsAt, nextEndsAt, id);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.startsAt !== undefined && { startsAt: nextStartsAt }),
          ...(dto.endsAt !== undefined && { endsAt: nextEndsAt }),
          ...(dto.params !== undefined && { params: dto.params as unknown as Prisma.InputJsonValue }),
        },
      });

      let action = 'CAMPAIGN_EDIT';
      if (activationChanged) action = 'CAMPAIGN_ACTIVATE';
      else if (existing.active && dto.active === false) action = 'CAMPAIGN_DEACTIVATE';

      await this.auditLog.log(
        {
          action,
          actorId,
          resourceType: 'Campaign',
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

  private deriveStatus(campaign: Campaign, now: Date): CampaignStatus {
    if (now < campaign.startsAt) return 'upcoming';
    if (now > campaign.endsAt) return 'ended';
    return 'live';
  }

  private snapshot(campaign: Campaign) {
    return {
      name: campaign.name,
      type: campaign.type,
      active: campaign.active,
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt.toISOString(),
      params: campaign.params,
    };
  }

  /**
   * Bloquea si ya existe otra campaña ACTIVE del mismo type con fechas que se
   * solapan (excluyendo self en edición). DEUDA CONOCIDA: check-then-act — dos
   * activaciones concurrentes de campañas inactivas solapadas del mismo type
   * podrían ambas pasar esta validación antes de que ninguna escriba. Riesgo
   * bajo (acción de admin, un actor, clics deliberados). El cierre robusto
   * sería un EXCLUDE constraint de Postgres (GiST sobre type + tsrange); no
   * implementado en esta fase.
   */
  private async assertNoOverlap(
    type: CampaignType,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.campaign.findFirst({
      where: {
        type,
        active: true,
        ...(excludeId && { id: { not: excludeId } }),
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });

    if (overlapping) {
      throw new BadRequestException({
        message: 'Ya existe una campaña activa del mismo tipo que se solapa en fechas',
        code: 'CAMPAIGN_OVERLAP',
      });
    }
  }
}
