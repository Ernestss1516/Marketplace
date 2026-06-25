import Stripe from 'stripe';

export const BILLING_JOB = {
  PROCESS_STRIPE_EVENT: 'process-stripe-event',
} as const;

export interface BillingJobData {
  eventType: string;
  payload: Stripe.Event['data']['object'];
  /** Metadata from the originating Checkout Session or Subscription. */
  metadata: Record<string, string>;
}

export const STRIPE_EVENTS = {
  CHECKOUT_SESSION_COMPLETED: 'checkout.session.completed',
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
} as const;

/** Spanish VAT rate applied to all prices (IVA peninsular general). */
export const VAT_RATE = 0.21;
