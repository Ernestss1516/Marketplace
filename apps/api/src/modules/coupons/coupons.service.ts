import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreditLedgerType, FeaturedOrigin } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { BillingService } from '../billing/billing.service';
import { RedeemCouponDto } from './dto/redeem-coupon.dto';

/** Returns true when the error is a Prisma unique constraint violation (P2002). */
function isP2002(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

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
}
