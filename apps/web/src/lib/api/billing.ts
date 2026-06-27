import { apiFetch } from './client';

export interface CatalogPrice {
  priceId: string;
  amount: number;
  currency: string;
  interval?: 'MONTH' | 'YEAR';
  intervalCount?: number;
  durationDays?: number;
  creditAmount?: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  type: 'ONE_TIME' | 'RECURRING';
  prices: CatalogPrice[];
}

export interface MySubscription {
  id: string;
  status: 'ACTIVE' | 'CANCELING' | 'CANCELED' | 'PAST_DUE';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  price: {
    amount: string | number;
    currency: string;
    interval?: string;
    intervalCount?: number;
    product: { name: string };
  };
}

export interface MyEntitlement {
  id: string;
  type: 'PRO_SUBSCRIPTION' | 'FEATURED_LISTING';
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  listingId: string | null;
}

export function getCatalog(): Promise<CatalogProduct[]> {
  return apiFetch<CatalogProduct[]>('/billing/catalog');
}

export function createCheckout(
  token: string,
  priceId: string,
): Promise<{ checkoutUrl: string }> {
  return apiFetch<{ checkoutUrl: string }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ priceId }),
    token,
  });
}

export function getMySubscriptions(token: string): Promise<MySubscription[]> {
  return apiFetch<MySubscription[]>('/billing/my-subscriptions', { token });
}

export function cancelSubscription(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/billing/cancel-subscription/${id}`, {
    method: 'POST',
    token,
  });
}

export function getMyEntitlements(token: string): Promise<MyEntitlement[]> {
  return apiFetch<MyEntitlement[]>('/billing/my-entitlements', { token });
}
