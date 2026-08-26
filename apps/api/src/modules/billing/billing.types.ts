import Stripe from 'stripe';

export const BILLING_JOB = {
  PROCESS_STRIPE_EVENT: 'process-stripe-event',
  /**
   * BORRADO DE CUENTAS C2 — cancelar en la pasarela las suscripciones de una
   * cuenta que se acaba de archivar.
   *
   * POR COLA Y NO EN LÍNEA: una cuenta archivada con Pro **sigue pagando** si la
   * llamada a Stripe falla, y una caída transitoria basta. En línea el fallo se
   * perdería en un `catch`; aquí lo recoge el `attempts: 3` con backoff de
   * `RETRY_JOB_OPTIONS`, que esta cola ya trae. Ver diseño §6.5.
   */
  CANCEL_SUBSCRIPTIONS: 'cancel-subscriptions',
} as const;

export interface BillingJobData {
  eventType: string;
  payload: Stripe.Event['data']['object'];
  /** Metadata from the originating Checkout Session or Subscription. */
  metadata: Record<string, string>;
}

/** Datos del job `CANCEL_SUBSCRIPTIONS`. El usuario, y nada más: qué suscripciones
 *  tiene se resuelve al ejecutarlo, no al encolarlo. */
export interface CancelSubscriptionsJobData {
  userId: string;
  /** C5 — corte inmediato al ELIMINAR; sin él, fin de periodo (archivar). */
  immediate?: boolean;
}

/** Lo que puede llegarle al `BillingProcessor`. Unión discriminada por `job.name`,
 *  que es lo que el `process()` ya miraba. */
export type BillingQueueJobData = BillingJobData | CancelSubscriptionsJobData;

export const STRIPE_EVENTS = {
  CHECKOUT_SESSION_COMPLETED: 'checkout.session.completed',
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
} as const;

/** Spanish VAT rate applied to all prices (IVA peninsular general). */
export const VAT_RATE = 0.21;
