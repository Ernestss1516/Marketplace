import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Coupon, CouponRewardType, CreditLedgerType, FeaturedOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { isP2002 } from '../../common/prisma/is-p2002';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BillingService } from '../billing/billing.service';
import { RedeemCouponDto } from './dto/redeem-coupon.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';

type CouponStatus = 'upcoming' | 'live' | 'ended';

export interface RedeemResult {
  rewardType: 'CREDITS' | 'FEATURED';
  creditAmount: number | null;
  featuredDurationDays: number | null;
}

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  /**
   * POST /coupons/redeem — H8 Bloque D fase 3a.
   *
   * El límite total (Coupon.redemptionCount) y el uno-por-usuario
   * (CouponRedemption.@@unique) son las dos protecciones de concurrencia — ver
   * los comentarios inline en cada punto. Ambas siguen el mismo criterio que ya
   * usa este proyecto para el débito de Wallet: incremento/verificación atómica
   * a nivel de fila, sin SELECT ... FOR UPDATE. A diferencia de la cuota Pro
   * (EntitlementService.hasAvailableFeaturedQuota), redemptionCount es un
   * contador FÍSICO, no un COUNT derivado — no hay fila "padre" que lockear.
   */
  async redeem(userId: string, dto: RedeemCouponDto): Promise<RedeemResult> {
    const code = dto.code.trim().toUpperCase();

    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      throw new NotFoundException({ message: 'Código no válido', code: 'COUPON_NOT_FOUND' });
    }

    const now = new Date();
    if (!coupon.active || now < coupon.startsAt || now > coupon.endsAt) {
      throw new BadRequestException({ message: 'Este cupón no está activo', code: 'COUPON_INACTIVE' });
    }

    if (coupon.rewardType === 'FEATURED' && !dto.listingId) {
      throw new BadRequestException({
        message: 'Elige un anuncio para destacar',
        code: 'LISTING_REQUIRED',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // (a) Límite total — incremento atómico condicional. Sin el WHERE
        // condicional, dos canjes concurrentes sobre el último uso disponible
        // leerían el mismo redemptionCount y ambos pasarían (bug); el UPDATE
        // condicional hace que Postgres serialice a nivel de fila — el segundo
        // relee el valor ya incrementado por el primero y el WHERE lo bloquea.
        const incremented = await tx.$executeRaw`
          UPDATE "Coupon" SET "redemptionCount" = "redemptionCount" + 1
          WHERE id = ${coupon.id} AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
        `;
        if (incremented === 0) {
          throw new ConflictException({
            message: 'Este cupón ya se ha agotado',
            code: 'COUPON_EXHAUSTED',
          });
        }

        // (b) Un uso por usuario — chequeo explícito para un 409 legible en el
        // caso normal. El @@unique([couponId, userId]) de CouponRedemption es
        // la red de seguridad dura si dos peticiones del MISMO usuario llegan
        // a la vez (ver catch de P2002 más abajo).
        const already = await tx.couponRedemption.findUnique({
          where: { couponId_userId: { couponId: coupon.id, userId } },
        });
        if (already) {
          throw new ConflictException({
            message: 'Ya has canjeado este cupón',
            code: 'COUPON_ALREADY_REDEEMED',
          });
        }

        // (c) Otorgar la recompensa
        let referenceType: string;
        let referenceId: string;

        if (coupon.rewardType === 'CREDITS') {
          const wallet = await tx.wallet.upsert({
            where: { userId },
            create: { userId, balance: coupon.creditAmount! },
            update: { balance: { increment: coupon.creditAmount! } },
            select: { id: true },
          });
          const ledger = await tx.creditLedger.create({
            data: {
              walletId: wallet.id,
              type: CreditLedgerType.COUPON_REDEEM,
              amount: coupon.creditAmount!,
              referenceType: 'Coupon',
              referenceId: coupon.id,
            },
          });
          referenceType = 'CreditLedger';
          referenceId = ledger.id;
        } else {
          // FEATURED — si grantFeaturedListingTx lanza (anuncio no ACTIVE, ya
          // destacado, o no es del usuario), TODA la tx hace rollback: el
          // redemptionCount incrementado en (a) también se deshace. El cupón
          // no se consume si el destacado elegido no era válido.
          const { entitlementId } = await this.billing.grantFeaturedListingTx(tx, {
            userId,
            listingId: dto.listingId!,
            durationDays: coupon.featuredDurationDays!,
            origin: FeaturedOrigin.COUPON,
          });
          referenceType = 'Entitlement';
          referenceId = entitlementId;
        }

        // (d) Registro de canje
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, userId, referenceType, referenceId },
        });
      });
    } catch (err) {
      if (isP2002(err)) {
        throw new ConflictException({
          message: 'Ya has canjeado este cupón',
          code: 'COUPON_ALREADY_REDEEMED',
        });
      }
      throw err;
    }

    // Reindexado FUERA de la tx (igual que featuredByCredits) — un job para un
    // destacado que podría haber hecho rollback es peor que no encolar nada.
    if (coupon.rewardType === 'FEATURED') {
      await this.indexingQueue.add('index', { listingId: dto.listingId! });
    }

    return {
      rewardType: coupon.rewardType,
      creditAmount: coupon.creditAmount,
      featuredDurationDays: coupon.featuredDurationDays,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — H8 Bloque D fase 3b. Sin lógica de concurrencia nueva (ya
  // resuelta en fase 3a); esto es gestión de catálogo, no canje.
  // ---------------------------------------------------------------------------

  async list(dto: ListCouponsDto) {
    const { rewardType, active, page = 1, perPage = 25 } = dto;

    const where: Prisma.CouponWhereInput = {
      ...(rewardType && { rewardType }),
      ...(active !== undefined && { active }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.coupon.count({ where }),
    ]);

    const now = new Date();
    const withStatus = items.map((c) => ({ ...c, status: this.deriveStatus(c, now) }));

    return { items: withStatus, total, page, perPage };
  }

  async create(dto: CreateCouponDto, actorId: string, ip?: string): Promise<Coupon> {
    const code = dto.code.trim().toUpperCase();
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }
    this.assertRewardFieldsMatchType(dto.rewardType, dto.creditAmount, dto.featuredDurationDays);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.coupon.create({
          data: {
            code,
            rewardType: dto.rewardType,
            creditAmount: dto.rewardType === CouponRewardType.CREDITS ? dto.creditAmount : null,
            featuredDurationDays:
              dto.rewardType === CouponRewardType.FEATURED ? dto.featuredDurationDays : null,
            maxRedemptions: dto.maxRedemptions ?? null,
            active: dto.active ?? true,
            startsAt,
            endsAt,
          },
        });

        await this.auditLog.log(
          {
            action: 'COUPON_CREATE',
            actorId,
            resourceType: 'Coupon',
            resourceId: created.id,
            after: this.snapshot(created) as unknown as Prisma.InputJsonValue,
            ip,
          },
          tx,
        );

        return created;
      });
    } catch (err) {
      if (isP2002(err)) {
        throw new ConflictException({
          message: 'Ya existe un cupón con ese código',
          code: 'COUPON_CODE_TAKEN',
        });
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCouponDto, actorId: string, ip?: string): Promise<Coupon> {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Cupón no encontrado');

    const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    if (nextEndsAt <= nextStartsAt) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }

    // El valor de la recompensa enviado debe corresponder al rewardType YA
    // fijado del cupón (inmutable) — no se puede, p. ej., mandar
    // featuredDurationDays a un cupón CREDITS.
    if (dto.creditAmount !== undefined && existing.rewardType !== CouponRewardType.CREDITS) {
      throw new BadRequestException('creditAmount solo aplica a cupones CREDITS');
    }
    if (
      dto.featuredDurationDays !== undefined &&
      existing.rewardType !== CouponRewardType.FEATURED
    ) {
      throw new BadRequestException('featuredDurationDays solo aplica a cupones FEATURED');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.coupon.update({
        where: { id },
        data: {
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.startsAt !== undefined && { startsAt: nextStartsAt }),
          ...(dto.endsAt !== undefined && { endsAt: nextEndsAt }),
          ...(dto.maxRedemptions !== undefined && { maxRedemptions: dto.maxRedemptions }),
          ...(dto.creditAmount !== undefined && { creditAmount: dto.creditAmount }),
          ...(dto.featuredDurationDays !== undefined && {
            featuredDurationDays: dto.featuredDurationDays,
          }),
        },
      });

      let action = 'COUPON_EDIT';
      if (dto.active === true && !existing.active) action = 'COUPON_ACTIVATE';
      else if (dto.active === false && existing.active) action = 'COUPON_DEACTIVATE';

      await this.auditLog.log(
        {
          action,
          actorId,
          resourceType: 'Coupon',
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

  private deriveStatus(coupon: Coupon, now: Date): CouponStatus {
    if (now < coupon.startsAt) return 'upcoming';
    if (now > coupon.endsAt) return 'ended';
    return 'live';
  }

  private snapshot(coupon: Coupon) {
    return {
      code: coupon.code,
      rewardType: coupon.rewardType,
      creditAmount: coupon.creditAmount,
      featuredDurationDays: coupon.featuredDurationDays,
      maxRedemptions: coupon.maxRedemptions,
      active: coupon.active,
      startsAt: coupon.startsAt.toISOString(),
      endsAt: coupon.endsAt.toISOString(),
    };
  }

  private assertRewardFieldsMatchType(
    rewardType: CouponRewardType,
    creditAmount?: number,
    featuredDurationDays?: number,
  ): void {
    if (rewardType === CouponRewardType.CREDITS && featuredDurationDays != null) {
      throw new BadRequestException('featuredDurationDays no debe enviarse para cupones CREDITS');
    }
    if (rewardType === CouponRewardType.FEATURED && creditAmount != null) {
      throw new BadRequestException('creditAmount no debe enviarse para cupones FEATURED');
    }
  }
}
