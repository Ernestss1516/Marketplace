import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type CreditLedgerType =
  | 'PACK_PURCHASE'
  | 'FEATURED_DEBIT'
  | 'BUMP_DEBIT'
  | 'ADMIN_CREDIT'
  | 'ADMIN_DEBIT'
  | 'PRO_BONUS';

export interface WalletItem {
  id: string;
  walletId: string;
  type: CreditLedgerType;
  amount: number;
  referenceId: string | null;
  referenceType: string | null;
  note: string | null;
  createdAt: string;
}

export interface WalletResponse {
  balance: number;
  items: WalletItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Redsys form data
// ---------------------------------------------------------------------------

export interface RedsysFormData {
  Ds_MerchantParameters: string;
  Ds_SignatureVersion: string;
  Ds_Signature: string;
  tpvUrl: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CatalogPrice {
  priceId: string;
  amount: number;
  currency: string;
  interval?: 'MONTH' | 'YEAR';
  intervalCount?: number;
  durationDays?: number;
  creditCost?: number;
  creditAmount?: number;
  creditPackId?: string;
  packName?: string;
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

export interface CatalogResponse {
  products: CatalogProduct[];
  bumpCreditCost: number;
}

export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>('/billing/catalog');
}

export function featuredByCredits(
  token: string,
  priceId: string,
  listingId: string,
): Promise<void> {
  return apiFetch<void>('/billing/featured-by-credits', {
    method: 'POST',
    body: JSON.stringify({ priceId, listingId }),
    token,
  });
}

export function createFeaturedCheckout(
  token: string,
  priceId: string,
  listingId: string,
): Promise<{ redsysFormData: RedsysFormData }> {
  return apiFetch<{ redsysFormData: RedsysFormData }>('/billing/checkout/featured-pay', {
    method: 'POST',
    body: JSON.stringify({ priceId, listingId }),
    token,
  });
}

export function bumpListing(
  token: string,
  listingId: string,
): Promise<{ bumpedAt: string }> {
  return apiFetch<{ bumpedAt: string }>(`/listings/${listingId}/bump`, {
    method: 'POST',
    token,
  });
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

export function getWallet(token: string, page = 1): Promise<WalletResponse> {
  return apiFetch<WalletResponse>(`/billing/wallet?page=${page}&perPage=20`, { token });
}

export function createPackCheckout(
  token: string,
  packId: string,
): Promise<{ redsysFormData: RedsysFormData }> {
  return apiFetch<{ redsysFormData: RedsysFormData }>('/billing/checkout/credits-pack', {
    method: 'POST',
    body: JSON.stringify({ packId }),
    token,
  });
}
