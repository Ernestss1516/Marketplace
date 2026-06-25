import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');
import { ListingStatus, ProductType, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EntitlementService } from './entitlement.service';
import { CheckoutDto } from './dto/checkout.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | undefined;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly config: ConfigService,
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

    // Ensure the user has a Stripe Customer. Set stripeCustomerId now so webhooks can
    // resolve the user even if they arrive before checkout.session.completed is processed.
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const successUrl = `${this.appUrl}/planes/exito?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${this.appUrl}/planes/cancelar`;

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
      // Propagate metadata to the Stripe Subscription so invoice events can use it.
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
}
