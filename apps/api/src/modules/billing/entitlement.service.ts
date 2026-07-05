import { Injectable } from '@nestjs/common';
import { EntitlementType, FeaturedOrigin } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

function activeFilter() {
  const now = new Date();
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

const DEFAULT_PRO_MONTHLY_FEATURED_QUOTA = 4;

/**
 * H8.2 — estado de la cuota mensual de destacados gratis de Pro.
 * isPro=false para no-Pro (no aplica cuota). periodStart/periodEnd solo
 * presentes cuando isPro=true (el ciclo de facturación de la Subscription
 * vinculada al PRO_SUBSCRIPTION vigente).
 */
export interface FeaturedQuotaStatus {
  isPro: boolean;
  limit: number;
  used: number;
  remaining: number;
  periodStart?: Date;
  periodEnd?: Date;
}

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if the user has an active PRO_SUBSCRIPTION entitlement.
   * Active = revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now()).
   */
  async isProActive(userId: string): Promise<boolean> {
    const row = await this.prisma.entitlement.findFirst({
      where: { userId, type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Returns true if the listing has an active FEATURED_LISTING entitlement.
   * Active = revokedAt IS NULL AND expiresAt > now().
   */
  async isFeaturedActive(listingId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.prisma.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Returns all active entitlements for a user (for the /my-entitlements endpoint). */
  async findActiveForUser(userId: string) {
    return this.prisma.entitlement.findMany({
      where: { userId, ...activeFilter() },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * H8.2 — cuota mensual de destacados gratis de Pro. Reseteo DERIVADO: no hay
   * contador que resetear ni cron. "Usado este periodo" se cuenta contando los
   * Entitlement FEATURED_LISTING con origin=PRO_QUOTA creados desde el inicio
   * del ciclo de facturación vigente (Subscription.currentPeriodStart, que
   * Stripe avanza en cada renovación — ver billing.processor.ts). En cuanto
   * avanza currentPeriodStart, los PRO_QUOTA del periodo anterior dejan de
   * contar automáticamente: no hace falta resetear nada.
   *
   * El periodo se obtiene de la Subscription vinculada al PRO_SUBSCRIPTION
   * vigente (Entitlement.subscriptionId), no de un findFirst genérico sobre
   * Subscription — evita ambigüedad si hay suscripciones canceladas
   * residuales para el mismo usuario.
   */
  async getFeaturedQuotaStatus(userId: string): Promise<FeaturedQuotaStatus> {
    const proEntitlement = await this.prisma.entitlement.findFirst({
      where: { userId, type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() },
      select: {
        subscription: { select: { currentPeriodStart: true, currentPeriodEnd: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // No entitlement, or (should not happen — ensureProEntitlement always links a
    // Subscription) one without a linked Subscription: no period to derive the
    // quota from, so no quota applies.
    if (!proEntitlement?.subscription) {
      return { isPro: false, limit: 0, used: 0, remaining: 0 };
    }

    const { currentPeriodStart, currentPeriodEnd } = proEntitlement.subscription;

    const setting = await this.prisma.setting.findUnique({
      where: { key: 'proMonthlyFeaturedQuota' },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : DEFAULT_PRO_MONTHLY_FEATURED_QUOTA;

    const used = await this.prisma.entitlement.count({
      where: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        origin: FeaturedOrigin.PRO_QUOTA,
        createdAt: { gte: currentPeriodStart },
      },
    });

    return {
      isPro: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
    };
  }
}
