import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');
import {
  CreditLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  Prisma,
  ProductType,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EntitlementService } from './entitlement.service';
import { CheckoutDto } from './dto/checkout.dto';
import { FeaturedByCreditsDto } from './dto/featured-by-credits.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';
import { WalletQueryDto } from './dto/wallet-query.dto';

// ---------------------------------------------------------------------------
// Shared interface for granting a featured listing entitlement.
// The single source of truth — both credit and Redsys paths use it.
// ---------------------------------------------------------------------------

export interface GrantFeaturedParams {
  userId: string;
  listingId: string;
  durationDays: number;
  /** Null for grants with no real Price behind them (coupons) — column is nullable, same as PRO_QUOTA. */
  priceId?: string;
  /** Only set when a real payment was made (Redsys path). */
  transactionId?: string;
  /** Which bag this grant comes from (H8.1/H8.2/H8 Bloque D fase 3) — CREDITS, REDSYS, PRO_QUOTA or COUPON. */
  origin: FeaturedOrigin;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | undefined;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly campaigns: CampaignsService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {
    this.appUrl = config.get<string>('appUrl', 'http://localhost:3000');
  }

  private get stripe(): Stripe {
    if (!this._stripe) {
      const key = this.config.get<string>('stripe.secretKey', '');
      if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
      this._stripe = new Stripe(key);
    }
    return this._stripe;
  }

  // ---------------------------------------------------------------------------
  // Stripe Pro checkout — RECURRING (Plan Pro) only.
  //
  // Featured listings (ONE_TIME) used to be purchasable here too, but that
  // path (BillingProcessor.handleOneTimePayment) never re-validated
  // ownership/ACTIVE/duplicate at grant time, never set `origin`, never
  // enqueued reindexing, and wasn't wrapped in the same $transaction as the
  // Transaction upsert — a retried webhook/job could grant a second
  // entitlement with nothing to stop it. Redsys is now the only card channel
  // for destacado (POST /billing/checkout/featured-pay, via
  // grantFeaturedListingTx). Closed explicitly below rather than left to
  // silently ignore a stray listingId.
  // ---------------------------------------------------------------------------

  async createCheckoutSession(userId: string, dto: CheckoutDto): Promise<{ checkoutUrl: string }> {
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      include: { product: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');

    if (price.product.type === ProductType.ONE_TIME) {
      throw new BadRequestException(
        'Los destacados no se compran por Stripe. Usa POST /billing/checkout/featured-pay (Redsys).',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true },
    });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const successUrl = `${this.appUrl}/planes/exito?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${this.appUrl}/planes/cancelado`;

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: price.gatewayPriceId ?? undefined, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, priceId: dto.priceId },
      subscription_data: {
        metadata: { userId, priceId: dto.priceId },
      },
    });

    if (!session.url) throw new BadRequestException('Stripe did not return a checkout URL');
    return { checkoutUrl: session.url };
  }

  async cancelSubscription(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.userId !== userId) throw new ForbiddenException('Not your subscription');
    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already canceled');
    }

    await this.stripe.subscriptions.update(subscription.gatewaySubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true, status: SubscriptionStatus.CANCELING },
    });

    this.logger.log(`Subscription ${subscriptionId} set to cancel at period end (user ${userId})`);
  }

  async getMySubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELING, SubscriptionStatus.PAST_DUE] },
      },
      include: { price: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyEntitlements(userId: string) {
    return this.entitlements.findActiveForUser(userId);
  }

  async getMyTransactions(userId: string, query: TransactionsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        include: { price: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  }

  // ---------------------------------------------------------------------------
  // Featured listing — unified grant operation (§3.2)
  // ---------------------------------------------------------------------------

  /**
   * Thin standalone wrapper around grantFeaturedListingTx for callers that don't
   * already have an open transaction: opens its own $transaction, then enqueues
   * reindexing and logs after commit.
   *
   * Called from RedsysProcessor.handleFeaturedPay, after Transaction.status is
   * set to SUCCEEDED. (Stripe used to have an equivalent one-time-payment path;
   * removed — Redsys is now the only card channel for destacado, see
   * BillingService.createCheckoutSession.)
   */
  async grantFeaturedListing(params: GrantFeaturedParams): Promise<void> {
    await this.prisma.$transaction((tx) => this.grantFeaturedListingTx(tx, params));

    await this.indexingQueue.add('index', { listingId: params.listingId });

    this.logger.log(
      `Featured listing granted: listingId=${params.listingId}, userId=${params.userId}, ` +
        `durationDays=${params.durationDays}, origin=${params.origin}, ` +
        `transactionId=${params.transactionId ?? 'none'}`,
    );
  }

  /**
   * The ONLY place that creates a FEATURED_LISTING entitlement (H8 Bloque D
   * fase 4 — unification). Validates listing ownership + ACTIVE + no existing
   * active entitlement, then Entitlement.create. No indexing enqueue, no
   * logging here — the caller's own transaction may still roll back after
   * this returns. Runs against the CALLER's `tx`, so it composes inside a
   * larger atomic operation. Returns the created entitlement's id for the
   * caller's own traceability (e.g. CouponRedemption.referenceId) without an
   * extra query.
   *
   * Called from (always inside a $transaction):
   *   - grantFeaturedListing (its own tx) — RedsysProcessor.handleFeaturedPay
   *   - BillingService.featuredByCredits — both the quota branch and the
   *     credits branch call this instead of creating the entitlement inline;
   *     each still runs its own assertFeaturable() pre-check first purely for
   *     a fast, structured `code: 'ALREADY_FEATURED'` HTTP response (same
   *     pattern as RedsysService's checkout-creation pre-check) — the
   *     re-validation in here is the real backstop, same tx/snapshot.
   *   - CouponsService.redeem — composed inside its own $transaction
   *
   * Duration is caller-supplied (`durationDays`) and legitimately differs by
   * channel: fixed Setting for Pro quota, Price.durationDays for Redsys/credits,
   * the coupon's own value for cupón. That's the one thing that's allowed to
   * diverge — the grant itself does not.
   */
  async grantFeaturedListingTx(
    tx: Prisma.TransactionClient,
    params: GrantFeaturedParams,
  ): Promise<{ entitlementId: string }> {
    const { userId, listingId, durationDays, priceId, transactionId, origin } = params;

    // Validate listing exists, is ACTIVE, and belongs to userId
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing || listing.sellerId !== userId) {
      throw new ForbiddenException('Listing does not exist or does not belong to you');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be featured');
    }

    // Check no active FEATURED_LISTING for this listing
    const existing = await tx.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Listing already has an active featured period');
    }

    // Create the entitlement
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const entitlement = await tx.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        expiresAt,
        priceId,
        origin,
        ...(transactionId && { transactionId }),
      },
      select: { id: true },
    });

    return { entitlementId: entitlement.id };
  }

  // ---------------------------------------------------------------------------
  // Featured listing — via credits (§3.3)
  // ---------------------------------------------------------------------------

  /**
   * Shared validation for both featuring paths, run inside the caller's TX:
   * listing exists, belongs to userId, is ACTIVE, and has no active featured period.
   */
  private async assertFeaturable(
    tx: Prisma.TransactionClient,
    userId: string,
    listingId: string,
    now: Date,
  ): Promise<void> {
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing || listing.sellerId !== userId) {
      throw new ForbiddenException('Listing does not exist or does not belong to you');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be featured');
    }

    const existing = await tx.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'Listing already has an active featured period',
        code: 'ALREADY_FEATURED',
      });
    }
  }

  private async getQuotaFeaturedDurationDays(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'proQuotaFeaturedDurationDays' },
    });
    return setting ? Number(setting.value) : 7;
  }

  /**
   * POST /billing/featured-by-credits
   *
   * H8.5a: the user CHOOSES the path via `dto.useQuota` — the backend no longer
   * picks quota automatically (that was H8.3; superseded by this ráfaga):
   *   - useQuota=true:  free grant from Pro's monthly quota, FIXED duration
   *     (proQuotaFeaturedDurationDays). Fails explicitly if no quota is left —
   *     never silently falls back to credits, since the user asked for quota.
   *   - useQuota=false (default): pays with credits, duration chosen via
   *     priceId (7/14/30d). Quota is left untouched even if available — the
   *     user can deliberately save it for later.
   *
   * Atomic: everything (quota check + grant, OR wallet debit + CreditLedger +
   * grant) happens in a single Postgres TX. Rollback restores credits if the
   * grant fails (e.g. already featured).
   */
  async featuredByCredits(
    userId: string,
    dto: FeaturedByCreditsDto,
  ): Promise<{ featuredUntil: Date; viaQuota: boolean }> {
    const { listingId } = dto;
    const now = new Date();

    if (dto.useQuota) {
      const durationDays = await this.getQuotaFeaturedDurationDays();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      await this.prisma.$transaction(async (tx) => {
        await this.assertFeaturable(tx, userId, listingId, now);

        // Locks the user's Subscription row (FOR UPDATE) for the rest of this TX,
        // so two concurrent quota requests can never both see the last free slot
        // available (see EntitlementService.hasAvailableFeaturedQuota's doc).
        const hasQuota = await this.entitlements.hasAvailableFeaturedQuota(tx, userId);
        if (!hasQuota) {
          throw new BadRequestException({
            message: 'No tienes cuota de destacados disponible este periodo',
            code: 'QUOTA_UNAVAILABLE',
          });
        }

        // Free grant — no wallet debit, no CreditLedger entry, no priceId (no
        // variant was chosen: the quota always uses the fixed duration above).
        await this.grantFeaturedListingTx(tx, {
          userId,
          listingId,
          durationDays,
          origin: FeaturedOrigin.PRO_QUOTA,
        });
      });

      await this.indexingQueue.add('index', { listingId });
      this.logger.log(
        `Featured via quota: listingId=${listingId}, userId=${userId}, durationDays=${durationDays}`,
      );
      return { featuredUntil: expiresAt, viaQuota: true };
    }

    // Credits path — unchanged behavior, quota is never touched here.
    if (!dto.priceId) {
      throw new BadRequestException('priceId is required when not using the quota');
    }
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      select: { id: true, active: true, durationDays: true, creditPackId: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');
    if (!price.durationDays) throw new BadRequestException('Not a featured listing price');
    if (price.creditPackId) throw new BadRequestException('Not a featured listing price');

    const baseCost = await this.getCreditCostForFeatured(price.durationDays);
    // H8 Bloque D fase 2 — descuento de campaña, calculado EN VIVO (no hay
    // checkout que congelar: destacar con créditos es un débito atómico
    // instantáneo, igual que bump). Solo esta rama (créditos); la rama de
    // cuota Pro de arriba ya ha devuelto antes de llegar aquí — el descuento
    // nunca la toca. floor (no ceil): redondeo a favor del usuario en promoción.
    const discount = await this.campaigns.getActiveActionDiscount('FEATURED');
    const cost = discount
      ? Math.floor(baseCost * (100 - (discount.params as { percent: number }).percent) / 100)
      : baseCost;
    const priceId = dto.priceId;
    const durationDays = price.durationDays;
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await this.prisma.$transaction(async (tx) => {
      await this.assertFeaturable(tx, userId, listingId, now);

      // Atomic debit: UPDATE ... WHERE balance >= cost
      const affected = await tx.$executeRaw`
        UPDATE "Wallet" SET balance = balance - ${cost}
        WHERE "userId" = ${userId} AND balance >= ${cost}
      `;
      if (affected === 0) {
        throw new HttpException('Insufficient credits', HttpStatus.PAYMENT_REQUIRED);
      }

      // Ledger entry — amount is the cost ALREADY discounted (the real debit).
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.FEATURED_DEBIT,
          amount: -cost,
          referenceType: 'Listing',
          referenceId: listingId,
          ...(discount && { note: `Campaña "${discount.name}" (-${(discount.params as { percent: number }).percent}%)` }),
        },
      });

      await this.grantFeaturedListingTx(tx, {
        userId,
        listingId,
        durationDays,
        priceId,
        origin: FeaturedOrigin.CREDITS,
      });
    });

    // After TX commits: enqueue reindexing
    await this.indexingQueue.add('index', { listingId });

    this.logger.log(
      `Featured by credits: listingId=${listingId}, userId=${userId}, ` +
        `durationDays=${durationDays}, cost=${cost}`,
    );

    return { featuredUntil: expiresAt, viaQuota: false };
  }

  // ---------------------------------------------------------------------------
  // Bump (§4)
  // ---------------------------------------------------------------------------

  /**
   * POST /listings/:id/bump
   * Atomic: wallet debit + CreditLedger + Listing.bumpedAt in a single Postgres TX.
   * Failed attempts (insufficient credits, cooldown, not ACTIVE) do NOT update bumpedAt.
   */
  async bump(listingId: string, userId: string): Promise<{ bumpedAt: Date }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true, bumpedAt: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== userId) throw new ForbiddenException('Not your listing');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be bumped');
    }

    // Cooldown check: if bumpedAt is within the last hour, reject
    const now = new Date();
    if (listing.bumpedAt) {
      const elapsedSeconds = (now.getTime() - listing.bumpedAt.getTime()) / 1000;
      if (elapsedSeconds < 3600) {
        const retryAfter = Math.ceil(3600 - elapsedSeconds);
        throw new HttpException(
          { message: 'Cooldown active — wait before bumping again', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const bumpCostSetting = await this.prisma.setting.findUnique({
      where: { key: 'bumpCreditCost' },
    });
    const baseCost = bumpCostSetting ? Number(bumpCostSetting.value) : 5;

    // H8 Bloque D fase 2 — mismo criterio que featuredByCredits: calculado en
    // vivo, floor a favor del usuario.
    const discount = await this.campaigns.getActiveActionDiscount('BUMP');
    const cost = discount
      ? Math.floor(baseCost * (100 - (discount.params as { percent: number }).percent) / 100)
      : baseCost;

    const bumpedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Atomic debit
      const affected = await tx.$executeRaw`
        UPDATE "Wallet" SET balance = balance - ${cost}
        WHERE "userId" = ${userId} AND balance >= ${cost}
      `;
      if (affected === 0) {
        throw new HttpException('Insufficient credits', HttpStatus.PAYMENT_REQUIRED);
      }

      // Ledger entry — amount is the cost ALREADY discounted (the real debit).
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.BUMP_DEBIT,
          amount: -cost,
          referenceType: 'Listing',
          referenceId: listingId,
          ...(discount && { note: `Campaña "${discount.name}" (-${(discount.params as { percent: number }).percent}%)` }),
        },
      });

      // Update bumpedAt — only on successful debit
      await tx.listing.update({
        where: { id: listingId },
        data: { bumpedAt },
      });
    });

    // After TX commits: enqueue reindexing so Meilisearch picks up new sortDate
    await this.indexingQueue.add('index', { listingId });

    this.logger.log(`Bump: listingId=${listingId}, userId=${userId}, cost=${cost}`);
    return { bumpedAt };
  }

  // ---------------------------------------------------------------------------
  // Wallet (§10 GET /billing/wallet)
  // ---------------------------------------------------------------------------

  async getWallet(userId: string, query: WalletQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return { balance: 0, items: [], total: 0, page, perPage, totalPages: 0 };
    }

    const [items, total] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.creditLedger.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      balance: wallet.balance,
      items,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  // ---------------------------------------------------------------------------
  // Catalog (public — no auth required)
  // ---------------------------------------------------------------------------

  async getCatalog() {
    const [products, settings] = await Promise.all([
      this.prisma.product.findMany({
        where: { active: true },
        include: {
          prices: {
            where: { active: true },
            include: { creditPack: true },
            orderBy: { amount: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.setting.findMany({
        where: {
          key: {
            in: [
              'featuredCreditCost7d',
              'featuredCreditCost14d',
              'featuredCreditCost30d',
              'bumpCreditCost',
            ],
          },
        },
      }),
    ]);

    const settingMap = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
    const featuredCreditCostByDays: Record<number, number> = {
      7: settingMap['featuredCreditCost7d'] ?? 30,
      14: settingMap['featuredCreditCost14d'] ?? 50,
      30: settingMap['featuredCreditCost30d'] ?? 100,
    };
    const baseBumpCreditCost = settingMap['bumpCreditCost'] ?? 5;

    // H8 Bloque D fase 2 — descuentos de campaña activos ahora mismo (a lo sumo
    // uno por acción). El catálogo es público y sin caché por request, así que
    // "en vivo" aquí es simplemente "leído en este momento", igual que el resto
    // del catálogo (Settings también se leen en vivo, sin congelar nada).
    const [featuredDiscount, bumpDiscount] = await Promise.all([
      this.campaigns.getActiveActionDiscount('FEATURED'),
      this.campaigns.getActiveActionDiscount('BUMP'),
    ]);
    const featuredDiscountPercent = featuredDiscount
      ? (featuredDiscount.params as { percent: number }).percent
      : null;
    const bumpDiscountPercent = bumpDiscount
      ? (bumpDiscount.params as { percent: number }).percent
      : null;
    const bumpCreditCost = bumpDiscountPercent != null
      ? Math.floor(baseBumpCreditCost * (100 - bumpDiscountPercent) / 100)
      : baseBumpCreditCost;

    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type as string,
        prices: p.prices.map((price) => {
          const baseFeaturedCost = price.durationDays != null
            ? featuredCreditCostByDays[price.durationDays] ?? 0
            : null;
          const featuredCost = baseFeaturedCost != null && featuredDiscountPercent != null
            ? Math.floor(baseFeaturedCost * (100 - featuredDiscountPercent) / 100)
            : baseFeaturedCost;
          return {
            priceId: price.id,
            amount: Number(price.amount),
            currency: price.currency,
            ...(price.interval != null
              ? { interval: price.interval as string, intervalCount: price.intervalCount ?? 1 }
              : {}),
            ...(price.durationDays != null
              ? {
                  durationDays: price.durationDays,
                  creditCost: featuredCost,
                  ...(featuredDiscountPercent != null && {
                    originalCreditCost: baseFeaturedCost,
                    discountPercent: featuredDiscountPercent,
                  }),
                }
              : {}),
            ...(price.creditPack != null
              ? {
                  creditAmount: price.creditPack.creditAmount,
                  creditPackId: price.creditPack.id,
                  packName: price.creditPack.name,
                }
              : {}),
          };
        }),
      })),
      bumpCreditCost,
      ...(bumpDiscountPercent != null && {
        bumpOriginalCreditCost: baseBumpCreditCost,
        bumpDiscountPercent,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads the credit cost for a featured listing duration from Setting.
   * Keys: featuredCreditCost7d | featuredCreditCost14d | featuredCreditCost30d.
   * Throws if the duration is not a supported variant.
   */
  private async getCreditCostForFeatured(durationDays: number): Promise<number> {
    const keyMap: Record<number, string> = {
      7: 'featuredCreditCost7d',
      14: 'featuredCreditCost14d',
      30: 'featuredCreditCost30d',
    };
    const key = keyMap[durationDays];
    if (!key) {
      throw new BadRequestException(`Unsupported featured duration: ${durationDays} days`);
    }
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting ? Number(setting.value) : 30;
  }
}
