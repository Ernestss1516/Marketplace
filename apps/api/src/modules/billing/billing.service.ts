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
  ListingStatus,
  ProductType,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
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
  priceId: string;
  /** Only set when a real payment was made (Redsys path). */
  transactionId?: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | undefined;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
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
  // Stripe Pro checkout (unchanged from RF.3)
  // ---------------------------------------------------------------------------

  async createCheckoutSession(userId: string, dto: CheckoutDto): Promise<{ checkoutUrl: string }> {
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      include: { product: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');

    const isOneTime = price.product.type === ProductType.ONE_TIME;

    if (isOneTime) {
      if (!dto.listingId) throw new BadRequestException('listingId is required for featured listings');
      const listing = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { id: true, status: true, sellerId: true },
      });
      if (!listing || listing.status !== ListingStatus.ACTIVE) {
        throw new BadRequestException('Only ACTIVE listings can be featured');
      }
      if (listing.sellerId !== userId) throw new ForbiddenException('Listing does not belong to you');

      const alreadyFeatured = await this.entitlements.isFeaturedActive(dto.listingId);
      if (alreadyFeatured) throw new BadRequestException('Listing already has an active featured period');
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

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: isOneTime ? 'payment' : 'subscription',
      line_items: [{ price: price.gatewayPriceId ?? undefined, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        priceId: dto.priceId,
        listingId: dto.listingId ?? '',
      },
    };

    if (!isOneTime) {
      sessionParams.subscription_data = {
        metadata: { userId, priceId: dto.priceId },
      };
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

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
   * The ONLY place that creates a FEATURED_LISTING entitlement.
   * Does NOT know how the feature was paid — receives the validated result.
   * Validates listing ownership + ACTIVE + no existing active entitlement.
   * Enqueues reindexing after the entitlement is persisted.
   *
   * Called from:
   *   - featuredByCredits (via internal $transaction path)
   *   - RedsysProcessor.handleFeaturedPay (standalone, after Transaction.status = SUCCEEDED)
   */
  async grantFeaturedListing(params: GrantFeaturedParams): Promise<void> {
    const { userId, listingId, durationDays, priceId, transactionId } = params;

    // Validate listing exists, is ACTIVE, and belongs to userId
    const listing = await this.prisma.listing.findUnique({
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
    const existing = await this.prisma.entitlement.findFirst({
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

    await this.prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        expiresAt,
        priceId,
        ...(transactionId && { transactionId }),
      },
    });

    // Enqueue reindexing so Meilisearch picks up boostScore = 1
    await this.indexingQueue.add('index', { listingId });

    this.logger.log(
      `Featured listing granted: listingId=${listingId}, userId=${userId}, ` +
        `durationDays=${durationDays}, transactionId=${transactionId ?? 'none'}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Featured listing — via credits (§3.3)
  // ---------------------------------------------------------------------------

  /**
   * POST /billing/featured-by-credits
   * Atomic: wallet debit + CreditLedger + Entitlement in a single Postgres TX.
   * Rollback restores credits if the grant fails (e.g. already featured).
   */
  async featuredByCredits(userId: string, dto: FeaturedByCreditsDto): Promise<void> {
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      select: { id: true, active: true, durationDays: true, creditPackId: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');
    if (!price.durationDays) throw new BadRequestException('Not a featured listing price');
    if (price.creditPackId) throw new BadRequestException('Not a featured listing price');

    const cost = await this.getCreditCostForFeatured(price.durationDays);
    const { listingId, priceId } = dto;
    const durationDays = price.durationDays;
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await this.prisma.$transaction(async (tx) => {
      // Validate listing ownership and status inside the TX
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

      // Check no active entitlement inside the TX
      const existing = await tx.entitlement.findFirst({
        where: {
          listingId,
          type: EntitlementType.FEATURED_LISTING,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException('Listing already has an active featured period');
      }

      // Atomic debit: UPDATE ... WHERE balance >= cost
      const affected = await tx.$executeRaw`
        UPDATE "Wallet" SET balance = balance - ${cost}
        WHERE "userId" = ${userId} AND balance >= ${cost}
      `;
      if (affected === 0) {
        throw new HttpException('Insufficient credits', HttpStatus.PAYMENT_REQUIRED);
      }

      // Ledger entry
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
        },
      });

      // Create entitlement (single source of truth: this is the ONLY place)
      await tx.entitlement.create({
        data: {
          userId,
          type: EntitlementType.FEATURED_LISTING,
          listingId,
          expiresAt,
          priceId,
        },
      });
    });

    // After TX commits: enqueue reindexing
    await this.indexingQueue.add('index', { listingId });

    this.logger.log(
      `Featured by credits: listingId=${listingId}, userId=${userId}, ` +
        `durationDays=${durationDays}, cost=${cost}`,
    );
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
    const cost = bumpCostSetting ? Number(bumpCostSetting.value) : 5;

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

      // Ledger entry
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
    const products = await this.prisma.product.findMany({
      where: { active: true },
      include: {
        prices: {
          where: { active: true },
          include: { creditPack: true },
          orderBy: { amount: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type as string,
      prices: p.prices.map((price) => ({
        priceId: price.id,
        amount: Number(price.amount),
        currency: price.currency,
        ...(price.interval != null
          ? { interval: price.interval as string, intervalCount: price.intervalCount ?? 1 }
          : {}),
        ...(price.durationDays != null ? { durationDays: price.durationDays } : {}),
        ...(price.creditPack != null ? { creditAmount: price.creditPack.creditAmount } : {}),
      })),
    }));
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
