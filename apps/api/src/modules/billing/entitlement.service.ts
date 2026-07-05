import { Injectable } from '@nestjs/common';
import { EntitlementType, FeaturedOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

function activeFilter() {
  const now = new Date();
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

const DEFAULT_PRO_MONTHLY_FEATURED_QUOTA = 4;
const DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS = 7;

/**
 * H8.2 — estado de la cuota mensual de destacados gratis de Pro.
 * isPro=false para no-Pro (no aplica cuota). periodStart/periodEnd/
 * quotaDurationDays solo presentes cuando isPro=true (el ciclo de facturación
 * de la Subscription vinculada al PRO_SUBSCRIPTION vigente).
 */
export interface FeaturedQuotaStatus {
  isPro: boolean;
  limit: number;
  used: number;
  remaining: number;
  periodStart?: Date;
  periodEnd?: Date;
  /** H8.5b — duración fija (días) que otorga un destacado pagado con la cuota. */
  quotaDurationDays?: number;
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

    const settings = await this.prisma.setting.findMany({
      where: { key: { in: ['proMonthlyFeaturedQuota', 'proQuotaFeaturedDurationDays'] } },
      select: { key: true, value: true },
    });
    const settingMap = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
    const limit = settingMap['proMonthlyFeaturedQuota'] ?? DEFAULT_PRO_MONTHLY_FEATURED_QUOTA;
    const quotaDurationDays =
      settingMap['proQuotaFeaturedDurationDays'] ?? DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS;

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
      quotaDurationDays,
    };
  }

  /**
   * H8.3 — comprueba si queda cuota Pro disponible Y RESERVA el hueco atómicamente
   * dentro de la transacción del caller (`tx`), bloqueando la fila de la
   * Subscription vinculada (`SELECT ... FOR UPDATE`).
   *
   * Por qué el lock es imprescindible: la cuota es DERIVADA (un COUNT, no un saldo
   * decrementable como el Wallet), así que dos peticiones concurrentes del mismo
   * usuario podrían leer "remaining=1" ANTES de que ninguna cree su Entitlement, y
   * ambas pasarían por cuota — dos destacados gratis con cupo para uno. El lock
   * serializa: la segunda petición espera a que la primera confirme (o revierta) su
   * transacción; al reanudar, su propio COUNT (ejecutado tras adquirir el lock) ya ve
   * el Entitlement PRO_QUOTA que la primera creó, y devuelve remaining=0 correctamente.
   * El mismo lock bloquea también una renovación de Stripe concurrente que intentara
   * avanzar `currentPeriodStart` a mitad de la operación.
   *
   * El caller SOLO debe crear el Entitlement PRO_QUOTA dentro de la misma `tx` si este
   * método devuelve `true` — el lock se mantiene hasta que esa `tx` confirme.
   */
  async hasAvailableFeaturedQuota(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const proEntitlement = await tx.entitlement.findFirst({
      where: { userId, type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() },
      select: { subscriptionId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!proEntitlement?.subscriptionId) return false;

    const rows = await tx.$queryRaw<{ currentPeriodStart: Date }[]>`
      SELECT "currentPeriodStart" FROM "Subscription" WHERE id = ${proEntitlement.subscriptionId} FOR UPDATE
    `;
    const currentPeriodStart = rows[0]?.currentPeriodStart;
    if (!currentPeriodStart) return false; // defensive — subscription row vanished mid-flight

    const setting = await tx.setting.findUnique({
      where: { key: 'proMonthlyFeaturedQuota' },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : DEFAULT_PRO_MONTHLY_FEATURED_QUOTA;

    const used = await tx.entitlement.count({
      where: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        origin: FeaturedOrigin.PRO_QUOTA,
        createdAt: { gte: currentPeriodStart },
      },
    });

    return used < limit;
  }
}
