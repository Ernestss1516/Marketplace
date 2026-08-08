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
  | 'PRO_BONUS'
  | 'CAMPAIGN_BONUS'
  | 'COUPON_REDEEM';

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
  /** Monetización ráfaga 2 — saldo de bumps, siempre presente (0 si nunca se ha tenido). */
  bumpBalance: number;
  items: WalletItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Monetización ráfaga 2 — saldo de bumps (moneda separada, historial propio)
// ---------------------------------------------------------------------------

export type BumpLedgerType =
  | 'COUPON_REDEEM'
  | 'BUMP_DEBIT'
  | 'ADMIN_CREDIT'
  | 'ADMIN_DEBIT'
  | 'PACK_PURCHASE'
  | 'PRO_BONUS'
  /** Campaña #10 — bonus de una campaña BUMP_BONUS al comprar un BumpPack. */
  | 'CAMPAIGN_BONUS';

export interface BumpLedgerItem {
  id: string;
  walletId: string;
  type: BumpLedgerType;
  amount: number;
  referenceId: string | null;
  referenceType: string | null;
  note: string | null;
  createdAt: string;
}

export interface BumpLedgerResponse {
  bumpBalance: number;
  items: BumpLedgerItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function getBumpLedger(token: string, page = 1): Promise<BumpLedgerResponse> {
  return apiFetch<BumpLedgerResponse>(`/billing/bump-ledger?page=${page}&perPage=20`, { token });
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
  /** Coste efectivo — ya con el descuento de campaña aplicado, si lo hay. */
  creditCost?: number;
  /** H8 Bloque D fase 2 — solo presente si hay un ACTION_DISCOUNT activo para destacar. */
  originalCreditCost?: number;
  discountPercent?: number;
  creditAmount?: number;
  creditPackId?: string;
  packName?: string;
  /** Monetización ráfaga 4 — solo presentes en Prices de packs de bumps directos. */
  bumpAmount?: number;
  bumpPackId?: string;
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
  /** Coste efectivo del bump — ya con el descuento de campaña aplicado, si lo hay. */
  bumpCreditCost: number;
  /** H8 Bloque D fase 2 — solo presentes si hay un ACTION_DISCOUNT activo para bump. */
  bumpOriginalCreditCost?: number;
  bumpDiscountPercent?: number;
  /** Monetización ráfaga 4 — SOLO para previsualizar "+N de regalo" en un pack
   * de bumps antes de comprar. Lo que de verdad se acredita se congela en el
   * checkout; esto nunca es lo que se cobra. */
  proExtraBumpsPercent: number;
}

// ---------------------------------------------------------------------------
// H8.5b — Pro featured quota status
// ---------------------------------------------------------------------------

export interface BumpQuotaStatus {
  limit: number;
  used: number;
  remaining: number;
}

export interface ProStatus {
  isPro: boolean;
  limit: number;
  used: number;
  remaining: number;
  periodStart?: string;
  periodEnd?: string;
  /** Fixed duration (days) a quota-paid featured grant lasts. */
  quotaDurationDays?: number;
  /** Monetización ráfaga 3 — cuota mensual de bumps gratis, mismo periodo. */
  bumpQuota: BumpQuotaStatus;
}

/** Single point the frontend consults for "how many free featured grants are left this month?" */
export function getProStatus(token: string): Promise<ProStatus> {
  return apiFetch<ProStatus>('/billing/pro-status', { token });
}

export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>('/billing/catalog');
}

/**
 * H8.5a/b — the caller chooses the path:
 *   - useQuota: true  → free grant from the Pro monthly quota, fixed duration; priceId ignored.
 *   - useQuota: false/omitted → pays with credits, duration chosen via priceId (required then).
 */
export function featuredByCredits(
  token: string,
  params: { listingId: string; useQuota?: boolean; priceId?: string },
): Promise<{ featuredUntil: string; viaQuota: boolean }> {
  return apiFetch<{ featuredUntil: string; viaQuota: boolean }>('/billing/featured-by-credits', {
    method: 'POST',
    body: JSON.stringify(params),
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

export type BumpPaidWith = 'PRO_QUOTA' | 'BUMP_BALANCE' | 'CREDITS';

export function bumpListing(
  token: string,
  listingId: string,
): Promise<{ bumpedAt: string; paidWith: BumpPaidWith; cost: number }> {
  return apiFetch<{ bumpedAt: string; paidWith: BumpPaidWith; cost: number }>(
    `/listings/${listingId}/bump`,
    {
      method: 'POST',
      token,
    },
  );
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

/**
 * UXV.3 (A7-flujo) — `returnTo` es la ruta a la que devolver al usuario tras la compra,
 * cuando salió a comprar desde una acción que no pudo pagar. Viaja hasta la URL de éxito
 * que el TPV usa al volver, porque el backend es quien la construye y la firma; el
 * frontend no puede conservarla por su cuenta a través del salto a Redsys. El backend
 * valida el destino contra una allowlist, así que mandar cualquier otra cosa no consigue
 * nada más que perder el retorno.
 */
export function createPackCheckout(
  token: string,
  packId: string,
  returnTo?: string,
): Promise<{ redsysFormData: RedsysFormData }> {
  return apiFetch<{ redsysFormData: RedsysFormData }>('/billing/checkout/credits-pack', {
    method: 'POST',
    body: JSON.stringify({ packId, ...(returnTo && { returnTo }) }),
    token,
  });
}

/** Monetización ráfaga 4 — mismo molde que createPackCheckout, moneda distinta (bumps directos). */
export function createBumpPackCheckout(
  token: string,
  packId: string,
  returnTo?: string,
): Promise<{ redsysFormData: RedsysFormData }> {
  return apiFetch<{ redsysFormData: RedsysFormData }>('/billing/checkout/bump-pack', {
    method: 'POST',
    body: JSON.stringify({ packId, ...(returnTo && { returnTo }) }),
    token,
  });
}
