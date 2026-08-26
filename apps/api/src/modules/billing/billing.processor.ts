import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Stripe = require('stripe');
import { Prisma, SubscriptionStatus, TransactionStatus, EntitlementType } from '@prisma/client';
import { QUEUE_BILLING } from '../../infra/queue/queue.constants';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BillingService } from './billing.service';
import {
  BILLING_JOB,
  BillingJobData,
  BillingQueueJobData,
  CancelSubscriptionsJobData,
  STRIPE_EVENTS,
  VAT_RATE,
} from './billing.types';

// ---------------------------------------------------------------------------
// Tax helpers (Stripe v22 API)
// ---------------------------------------------------------------------------

/**
 * Derive tax breakdown from a Stripe Invoice (v22).
 * Stripe Tax: uses invoice.total_taxes and invoice.subtotal_excluding_tax.
 * Fallback: Spanish VAT 21% calculated from amount_paid.
 */
function invoiceTaxBreakdown(invoice: Stripe.Invoice): {
  amountGross: Prisma.Decimal;
  amountNet: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
} {
  const grossCents = invoice.amount_paid ?? invoice.amount_due ?? 0;
  const amountGross = new Prisma.Decimal(grossCents).div(100);

  // Stripe Tax active: total_taxes array contains per-rate breakdowns.
  const totalTaxCents = invoice.total_taxes?.reduce((sum, t) => sum + t.amount, 0);
  if (totalTaxCents != null && totalTaxCents > 0 && invoice.subtotal_excluding_tax != null) {
    const amountNet = new Prisma.Decimal(invoice.subtotal_excluding_tax).div(100);
    const taxAmount = new Prisma.Decimal(totalTaxCents).div(100);
    const taxRate = amountNet.gt(0)
      ? taxAmount.div(amountNet).toDecimalPlaces(4)
      : new Prisma.Decimal(VAT_RATE);
    return { amountGross, amountNet, taxAmount, taxRate };
  }

  // Fallback: Spanish VAT 21%.
  const taxRate = new Prisma.Decimal(VAT_RATE);
  const amountNet = amountGross.div(new Prisma.Decimal(1).add(taxRate)).toDecimalPlaces(2);
  const taxAmount = amountGross.sub(amountNet).toDecimalPlaces(2);
  return { amountGross, amountNet, taxAmount, taxRate };
}

/** Extract the Stripe Price ID from a v22 InvoiceLineItem. */
function stripePriceIdFromLine(line: Stripe.InvoiceLineItem): string | undefined {
  const p = line.pricing?.price_details?.price;
  if (!p) return undefined;
  return typeof p === 'string' ? p : p.id;
}

/** Extract subscription ID (string) from a v22 InvoiceLineItem. */
function subscriptionIdFromLine(line: Stripe.InvoiceLineItem): string | undefined {
  const s = line.subscription;
  if (!s) return undefined;
  return typeof s === 'string' ? s : s.id;
}

/** Extract current period bounds from a v22 Subscription (now on SubscriptionItem). */
function periodFromSubscription(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items?.data[0];
  if (item?.current_period_start && item?.current_period_end) {
    return {
      start: new Date(item.current_period_start * 1000),
      end: new Date(item.current_period_end * 1000),
    };
  }
  // Fallback using billing cycle anchor when items are not expanded.
  const now = new Date();
  return {
    start: now,
    end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}

// ---------------------------------------------------------------------------
// Stripe v22 — invoice.parent structure (not yet in SDK typedefs)
// ---------------------------------------------------------------------------

interface InvoiceParentV22 {
  type?: string;
  subscription_details?: {
    subscription?: string | null;
    metadata?: Record<string, string> | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

@Processor(QUEUE_BILLING)
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    // BORRADO DE CUENTAS C2 — para `CANCEL_SUBSCRIPTIONS`. `BillingService` es
    // quien tiene el cliente de Stripe (un getter perezoso), así que la
    // cancelación vive allí y aquí sólo se dispara. Los dos son providers del
    // MISMO módulo: no hay ciclo.
    private readonly billing: BillingService,
  ) {
    super();
  }

  async process(job: Job<BillingQueueJobData>): Promise<void> {
    try {
      // BORRADO DE CUENTAS C2 — la cancelación de una cuenta archivada (§6.5).
      // Entra por la misma cola para heredar sus reintentos, y se distingue por
      // `job.name`, que es lo que este `process` ya miraba.
      if (job.name === BILLING_JOB.CANCEL_SUBSCRIPTIONS) {
        const { userId, immediate } = job.data as CancelSubscriptionsJobData;
        const canceladas = await this.billing.cancelActiveSubscriptionsFor(userId, immediate);
        this.logger.log(
          `Cuenta archivada ${userId}: ${canceladas} suscripción(es) marcadas para no renovar`,
        );
        return;
      }

      if (job.name !== BILLING_JOB.PROCESS_STRIPE_EVENT) {
        this.logger.warn(`Unknown billing job: ${job.name}`);
        return;
      }
      const { eventType, payload } = job.data as BillingJobData;
      switch (eventType) {
        case STRIPE_EVENTS.CHECKOUT_SESSION_COMPLETED:
          return this.handleCheckoutCompleted(payload as Stripe.Checkout.Session);
        case STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED:
          return this.handleInvoiceSucceeded(payload as Stripe.Invoice);
        case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED:
          return this.handleInvoiceFailed(payload as Stripe.Invoice);
        case STRIPE_EVENTS.SUBSCRIPTION_UPDATED:
          return this.handleSubscriptionUpdated(payload as Stripe.Subscription);
        case STRIPE_EVENTS.SUBSCRIPTION_DELETED:
          return this.handleSubscriptionDeleted(payload as Stripe.Subscription);
        default:
          this.logger.warn(`Unhandled billing event type: ${eventType}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // checkout.session.completed
  // ---------------------------------------------------------------------------

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const { userId, priceId } = session.metadata ?? {};
    if (!userId || !priceId) {
      this.logger.warn(`checkout.session.completed missing metadata: ${session.id}`);
      return;
    }

    // Persist stripeCustomerId. Must NOT swallow errors: if this silently fails,
    // the user's next payment creates a SECOND Stripe customer (no way to
    // reconcile after the fact). Let it throw — the rest of this handler hasn't
    // run yet, so BullMQ's retry (QUEUE_BILLING, attempts:3) re-enters cleanly
    // from the top rather than duplicating a partial grant.
    if (session.customer) {
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    // mode: 'payment' (ONE_TIME/destacado) is no longer sold through Stripe —
    // BillingService.createCheckoutSession rejects it before a session can be
    // created. This only fires for a session created before that change; log
    // loudly instead of silently granting (see git history for the removed
    // handleOneTimePayment).
    if (session.mode === 'payment') {
      this.logger.warn(
        `checkout.session.completed with mode=payment — Stripe one-time/destacado checkout is discontinued, ignoring: ${session.id}`,
      );
      return;
    }
    if (session.mode === 'subscription') {
      await this.handleSubscriptionCheckout(session, userId, priceId);
    }
  }

  /** RECURRING: creates Subscription + PRO Entitlement (no Transaction — that comes from invoice). */
  private async handleSubscriptionCheckout(
    session: Stripe.Checkout.Session,
    userId: string,
    priceId: string,
  ): Promise<void> {
    const subRef = session.subscription;
    const gatewaySubscriptionId =
      subRef == null ? null : typeof subRef === 'string' ? subRef : subRef.id;

    if (!gatewaySubscriptionId) {
      this.logger.warn(`checkout.session.completed has no subscription: ${session.id}`);
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Subscription + Entitlement en la misma $transaction: un fallo entre
    // ambas dejaría al usuario habiendo pagado sin acceso Pro y sin forma de
    // que un reintento lo complete limpiamente (mismo patrón que Redsys).
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.upsert({
        where: { gatewaySubscriptionId },
        create: {
          userId,
          priceId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          gatewaySubscriptionId,
        },
        update: { status: SubscriptionStatus.ACTIVE },
      });

      await this.ensureProEntitlement(userId, priceId, gatewaySubscriptionId, periodEnd, tx);
    });
    this.logger.log(`SUBSCRIPTION checkout processed: session=${session.id}, user=${userId}`);
  }

  // ---------------------------------------------------------------------------
  // invoice.payment_succeeded
  // ---------------------------------------------------------------------------

  private async handleInvoiceSucceeded(invoice: Stripe.Invoice): Promise<void> {
    // Stripe v22: subscription ID moved to invoice.parent.subscription_details.subscription
    // for the first invoice of a new subscription. Renewal invoices still populate
    // InvoiceLineItem.subscription. Read both and take whichever is present.
    const parent = (invoice as unknown as { parent?: InvoiceParentV22 }).parent;
    const parentSubscriptionId = parent?.subscription_details?.subscription ?? undefined;

    const firstLine = invoice.lines?.data[0];
    const lineSubscriptionId = firstLine ? subscriptionIdFromLine(firstLine) : undefined;

    const gatewaySubscriptionId = parentSubscriptionId ?? lineSubscriptionId;

    if (!gatewaySubscriptionId) {
      // One-time invoice (no subscription link in either source); skip.
      // The Transaction was already created in handleOneTimePayment.
      return;
    }

    const tax = invoiceTaxBreakdown(invoice);

    // Stripe Price ID for resolving our internal Price record.
    const stripePriceId = firstLine ? stripePriceIdFromLine(firstLine) : undefined;
    const price = stripePriceId
      ? await this.prisma.price.findUnique({
          where: { gatewayPriceId: stripePriceId },
          select: { id: true },
        })
      : null;

    const periodEnd = firstLine?.period?.end
      ? new Date(firstLine.period.end * 1000)
      : undefined;
    const periodStart = firstLine?.period?.start
      ? new Date(firstLine.period.start * 1000)
      : undefined;

    // Crear/extender Subscription + Entitlement y registrar la Transaction en
    // UNA sola $transaction: un fallo a mitad de camino revierte todo entero,
    // y el reintento de BullMQ arranca siempre desde un estado limpio (mismo
    // patrón que grantFeaturedListingAndSucceed / handlePackPurchase en Redsys
    // — ver docs/estado-tecnico.md, "Stripe — checkout + renovación...").
    await this.prisma.$transaction(async (tx) => {
      // Find or create Subscription (order-tolerant: invoice may arrive before checkout.completed).
      let subscription = await tx.subscription.findUnique({
        where: { gatewaySubscriptionId },
      });

      if (!subscription) {
        // Resolve user via stripeCustomerId (always set before checkout session is created).
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const user = customerId
          ? await tx.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } })
          : null;

        if (!user || !price) {
          throw new Error(
            `invoice.payment_succeeded: cannot resolve user/price for sub ${gatewaySubscriptionId}`,
          );
        }

        const periodEndResolved = periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const periodStartResolved = periodStart ?? new Date();

        subscription = await tx.subscription.upsert({
          where: { gatewaySubscriptionId },
          create: {
            userId: user.id,
            priceId: price.id,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: periodStartResolved,
            currentPeriodEnd: periodEndResolved,
            gatewaySubscriptionId,
          },
          update: { currentPeriodEnd: periodEndResolved, status: SubscriptionStatus.ACTIVE },
        });

        await this.ensureProEntitlement(user.id, price.id, gatewaySubscriptionId, periodEndResolved, tx);
      } else if (periodEnd) {
        // Renewal: update period end and extend Entitlement.
        subscription = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodEnd: periodEnd,
            ...(periodStart && { currentPeriodStart: periodStart }),
            status: SubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: false,
          },
        });
        await tx.entitlement.updateMany({
          where: { subscriptionId: subscription.id, type: EntitlementType.PRO_SUBSCRIPTION },
          data: { expiresAt: periodEnd },
        });
      }

      // Idempotent Transaction record.
      if (invoice.id) {
        await tx.transaction.upsert({
          where: { gatewayInvoiceId: invoice.id },
          create: {
            userId: subscription.userId,
            priceId: price?.id ?? subscription.priceId,
            ...tax,
            status: TransactionStatus.SUCCEEDED,
            gatewayInvoiceId: invoice.id,
            subscriptionId: subscription.id,
          },
          update: { status: TransactionStatus.SUCCEEDED },
        });
      }
    });
    this.logger.log(`invoice.payment_succeeded processed: inv=${invoice.id}`);
  }

  // ---------------------------------------------------------------------------
  // invoice.payment_failed
  // ---------------------------------------------------------------------------

  private async handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    const firstLine = invoice.lines?.data[0];
    const gatewaySubscriptionId = firstLine ? subscriptionIdFromLine(firstLine) : undefined;
    if (!gatewaySubscriptionId) return;

    await this.prisma.subscription.updateMany({
      where: { gatewaySubscriptionId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
    this.logger.warn(`invoice.payment_failed: sub=${gatewaySubscriptionId} → PAST_DUE`);
  }

  // ---------------------------------------------------------------------------
  // customer.subscription.updated
  // ---------------------------------------------------------------------------

  private async handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
    const { start: periodStart, end: periodEnd } = periodFromSubscription(sub);
    const status = this.mapStripeStatus(sub.status, sub.cancel_at_period_end);

    await this.prisma.subscription.upsert({
      where: { gatewaySubscriptionId: sub.id },
      create: {
        userId: await this.resolveUserIdFromCustomer(sub.customer),
        priceId: await this.resolvePriceId(sub.items?.data[0]?.price?.id),
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        gatewaySubscriptionId: sub.id,
      },
      update: {
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
    });
    this.logger.log(`customer.subscription.updated: sub=${sub.id} → ${status}`);
  }

  // ---------------------------------------------------------------------------
  // customer.subscription.deleted
  // ---------------------------------------------------------------------------

  private async handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const { start: periodStart, end: periodEnd } = periodFromSubscription(sub);

    await this.prisma.subscription.upsert({
      where: { gatewaySubscriptionId: sub.id },
      create: {
        userId: await this.resolveUserIdFromCustomer(sub.customer),
        priceId: await this.resolvePriceId(sub.items?.data[0]?.price?.id),
        status: SubscriptionStatus.CANCELED,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
        gatewaySubscriptionId: sub.id,
      },
      update: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
      },
    });
    this.logger.log(`customer.subscription.deleted: sub=${sub.id} → CANCELED`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapStripeStatus(
    stripeStatus: string,
    cancelAtPeriodEnd: boolean,
  ): SubscriptionStatus {
    if (stripeStatus === 'active' && cancelAtPeriodEnd) return SubscriptionStatus.CANCELING;
    switch (stripeStatus) {
      case 'active':   return SubscriptionStatus.ACTIVE;
      case 'past_due': return SubscriptionStatus.PAST_DUE;
      case 'canceled': return SubscriptionStatus.CANCELED;
      default:         return SubscriptionStatus.ACTIVE;
    }
  }

  private async resolveUserIdFromCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): Promise<string> {
    const customerId = typeof customer === 'string' ? customer : (customer?.id ?? '');
    if (!customerId) throw new Error('Stripe event has no customer ID');
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (!user) throw new Error(`No user found for stripeCustomerId: ${customerId}`);
    return user.id;
  }

  private async resolvePriceId(gatewayPriceId?: string): Promise<string> {
    if (!gatewayPriceId) throw new Error('Stripe event has no price ID');
    const price = await this.prisma.price.findUnique({
      where: { gatewayPriceId },
      select: { id: true },
    });
    if (!price) throw new Error(`No Price found for gatewayPriceId: ${gatewayPriceId}`);
    return price.id;
  }

  /**
   * Upsert a PRO_SUBSCRIPTION entitlement for a subscription.
   * Idempotent: updates expiresAt if the entitlement already exists.
   * Accepts an optional transaction client so callers can fold this into
   * their own $transaction (both call sites do, as of the atomicity fix).
   */
  private async ensureProEntitlement(
    userId: string,
    priceId: string,
    gatewaySubscriptionId: string,
    expiresAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const subscription = await client.subscription.findUnique({
      where: { gatewaySubscriptionId },
      select: { id: true },
    });
    if (!subscription) return;

    const existing = await client.entitlement.findFirst({
      where: { subscriptionId: subscription.id, type: EntitlementType.PRO_SUBSCRIPTION },
      select: { id: true },
    });

    if (existing) {
      await client.entitlement.update({ where: { id: existing.id }, data: { expiresAt } });
      return;
    }

    await client.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        priceId,
        subscriptionId: subscription.id,
        expiresAt,
      },
    });
  }
}
