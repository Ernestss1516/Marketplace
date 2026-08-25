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
  /**
   * E-4/E-5 — LO QUE UN PRO SE LLEVA DE REGALO CON ESTE PACK, calculado en el servidor.
   *
   * Presente en los dos tipos de pack (créditos y bumps), cada uno con su ajuste. Se sirve
   * ya resuelto a propósito: la lista lo pintaba antes repitiendo la fórmula
   * (`Math.ceil(x * pct / 100)`), una segunda copia que podía separarse de la que de verdad
   * cobra el checkout. Ahora la lista **enseña el número que el servidor va a congelar**.
   *
   * NO depende de quién pregunta: es el regalo del pack, no del usuario. Un Pro lo ve como
   * lo suyo; a un no-Pro se le enseña como lo que se está perdiendo.
   */
  proBonusAmount?: number;
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
  /**
   * PARIDAD DEL PRO MANUAL — la PROCEDENCIA, que el payload ya traía y este tipo callaba.
   * `null` = concedido por el equipo; con valor = viene de una suscripción de pago. Es la
   * marca que distingue los dos Pro (no hay columna `source`: esto ES la procedencia), y la
   * necesita `/perfil/suscripcion` para saber qué contarle a cada uno.
   */
  subscriptionId: string | null;
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
  /**
   * E-5 — el hermano de créditos, que el catálogo no publicaba. Sin él, la lista de packs
   * de créditos no tenía con qué contarle a un no-Pro qué se pierde. Opcional porque un
   * backend anterior a este cambio no lo manda.
   */
  proExtraCreditsPercent?: number;
  /**
   * E-6 — las cuotas mensuales en número, para que quien avise a un no-Pro diga la cifra
   * configurada y no una escrita a mano. Opcionales: un backend anterior no las manda.
   */
  proMonthlyFeaturedQuota?: number;
  proMonthlyBumpQuota?: number;
  /**
   * UXV.6 (M4) — los beneficios de Pro, derivados en el backend de los `Setting` que de
   * verdad los conceden. Antes esta lista vivía escrita a mano en `/planes` y prometía
   * cosas distintas de las que la app hacía. Opcional en el tipo porque un backend
   * anterior al despliegue no lo manda: la página cae entonces a una lista mínima.
   */
  proBenefits?: string[];
  /** UXV.6 (M4) — igual, para la tarjeta del plan gratuito. */
  freeBenefits?: string[];
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
  /**
   * FICHA DE USUARIO — U1: de dónde sale el periodo de la cuota mensual.
   * `NONE` = no hay ciclo de facturación, así que la cuota mensual no aplica —
   * lo que NO significa que el usuario no sea Pro (eso lo dice `isPro`).
   *
   * OPCIONAL en el frontend a propósito: es aditivo, y ninguna pantalla lo
   * necesita todavía. Se declara para que exista el concepto en este lado y para
   * que quien pinte la cuota pueda distinguir «cero de cuatro» de «no aplica».
   */
  quotaSource?: 'SUBSCRIPTION' | 'NONE';
  /**
   * PARIDAD DEL PRO MANUAL — EL EJE QUE ESTE LADO NO TENÍA.
   *
   * «¿Tiene una suscripción de pago viva?». Distinto de `isPro`, que sólo dice si hay un
   * entitlement Pro vigente — y un Pro CONCEDIDO por el equipo es Pro **sin** suscripción.
   * Fundir las dos preguntas en `isPro` es de donde salían los dos huecos de §1.5: la
   * página de suscripción dejaba en blanco al Pro manual y `/planes` le impedía pagar.
   *
   * QUIÉN PREGUNTA QUÉ, y no da igual:
   *   · «¿puede comprar el plan?» → `hasActiveSubscription` (lo mismo que mira el guard
   *     del checkout en el servidor).
   *   · «¿tiene las ventajas Pro?» → `isPro`.
   *
   * OPCIONAL como `quotaSource`, y con la misma consecuencia deliberada: cuando falta
   * —payload de un despliegue anterior, o el respaldo de un `.catch()`— se trata como
   * `false`, o sea NO se bloquea la compra. Es la política que el botón ya tenía escrita:
   * ante la duda decide el servidor, que es quien puede hacerlo sin equivocarse.
   */
  hasActiveSubscription?: boolean;
}

/** Single point the frontend consults for "how many free featured grants are left this month?" */
export function getProStatus(token: string): Promise<ProStatus> {
  return apiFetch<ProStatus>('/billing/pro-status', { token });
}

export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>('/billing/catalog');
}

/**
 * R4 — CON CUÁNTOS COMPETIRÍA Y CUÁNTO SALDRÍA, para decírselo al vendedor ANTES de cobrarle.
 *
 * La cuota la calcula el SERVIDOR, no el frontend, y no es un detalle de reparto de capas: la
 * fórmula es la misma con la que la rotación parte el anillo, y depende del tamaño del bloque y
 * de la ventana, que viven en el backend (la ventana es incluso ajustable por entorno).
 * Calcularla aquí sería una segunda copia condenada a divergir en cuanto se toque cualquiera de
 * las dos. Aquí sólo se pinta.
 */
export interface FeaturedCompetition {
  categoria: { name: string; slug: string } | null;
  /** Destacados vigentes que YA hay en esa categoría, sin contar el anuncio que pregunta. */
  vigentes: number;
  cuota: {
    /** `vigentes + 1`: el reparto que habría CON este anuncio dentro. */
    candidatos: number;
    grupos: number;
    /** `true` cuando caben todos en el bloque y no hay turnos que esperar. */
    siempre: boolean;
    minutosDeVitrinaAlDia: number;
    cicloMinutos: number;
  };
}

export function getFeaturedCompetition(
  listingId: string,
  token: string,
): Promise<FeaturedCompetition> {
  return apiFetch<FeaturedCompetition>(`/billing/featured-competition/${listingId}`, { token });
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
