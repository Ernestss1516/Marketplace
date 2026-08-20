import { apiFetch } from './client';

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface AdminTransaction {
  id: string;
  gateway: string;
  status: string;
  amountGross: string;
  currency: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface PaginatedAdminTransactions {
  items: AdminTransaction[];
  total: number;
  page: number;
  perPage: number;
}

export interface AdminTransactionsParams {
  gateway?: string;
  status?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}

export function getAdminTransactions(
  token: string,
  params: AdminTransactionsParams = {},
): Promise<PaginatedAdminTransactions> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.gateway) qs.set('gateway', params.gateway);
  if (params.status) qs.set('status', params.status);
  if (params.userId) qs.set('userId', params.userId);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminTransactions>(`/admin/billing/transactions?${qs}`, {
    token,
    cache: 'no-store',
  });
}

// ─── Wallets ──────────────────────────────────────────────────────────────────

export interface AdminWallet {
  id: string;
  balance: number;
  updatedAt: string;
  user: { id: string; name: string; email: string };
}

export interface PaginatedAdminWallets {
  items: AdminWallet[];
  total: number;
  page: number;
  perPage: number;
}

export function getAdminWallets(
  token: string,
  params: { q?: string; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminWallets> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.q) qs.set('q', params.q);
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminWallets>(`/admin/billing/wallets?${qs}`, {
    token,
    cache: 'no-store',
  });
}

// ─── User billing detail ──────────────────────────────────────────────────────

export interface AdminLedgerEntry {
  id: string;
  type: string;
  amount: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminWalletDetail {
  id: string;
  balance: number;
  /** U3 — la otra moneda: los bumps son un saldo aparte, no un tipo de crédito. */
  bumpBalance: number;
  updatedAt: string;
  entries: AdminLedgerEntry[];
  bumpEntries: AdminLedgerEntry[];
}

export interface AdminEntitlement {
  id: string;
  type: string;
  listingId: string | null;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /**
   * U3 — DE AQUÍ SE DERIVA LA PROCEDENCIA: con suscripción es un Pro de pago,
   * sin ella es una concesión del staff. No hay columna `source` porque sería
   * una segunda verdad que puede desincronizarse de ésta (U2).
   */
  subscriptionId: string | null;
}

export interface AdminUserBillingDetail {
  user: { id: string; name: string; email: string };
  wallet: AdminWalletDetail | null;
  entitlements: AdminEntitlement[];
  transactions: Array<{
    id: string;
    gateway: string;
    status: string;
    amountGross: string;
    currency: string;
    createdAt: string;
  }>;
}

export function getAdminUserBillingDetail(
  token: string,
  userId: string,
): Promise<AdminUserBillingDetail> {
  return apiFetch<AdminUserBillingDetail>(`/admin/billing/users/${userId}`, {
    token,
    cache: 'no-store',
  });
}

// ─── Credit grant ─────────────────────────────────────────────────────────────

export interface CreditGrantResult {
  balance: number;
  creditedAmount: number;
}

export function grantAdminCredits(
  token: string,
  userId: string,
  dto: { amount: number; reason: string },
): Promise<CreditGrantResult> {
  return apiFetch<CreditGrantResult>(`/admin/billing/users/${userId}/credits`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

// ─── Ficha de usuario U3 — las acciones de U2 ────────────────────────────────
//
// TODAS son ADMIN en el backend (el `@MinRole(Role.ADMIN)` de la clase del
// controlador). Estas funciones no comprueban nada: la comprobación de verdad
// está allí, y la ficha simplemente no ofrece los botones a quien no puede.

/** Conceder Pro a mano. `expiresAt` es obligatorio — el backend rechaza sin él. */
export function grantAdminPro(
  token: string,
  userId: string,
  dto: { expiresAt: string; reason: string },
): Promise<{ id: string; expiresAt: string }> {
  return apiFetch(`/admin/billing/users/${userId}/pro`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

/** Retirar el Pro CONCEDIDO A MANO. El backend no toca los de pago. */
export function revokeAdminPro(
  token: string,
  userId: string,
  dto: { reason: string },
): Promise<{ revoked: number }> {
  return apiFetch(`/admin/billing/users/${userId}/pro/revoke`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function grantAdminBumps(
  token: string,
  userId: string,
  dto: { amount: number; reason: string },
): Promise<{ bumpBalance: number; creditedAmount: number }> {
  return apiFetch(`/admin/billing/users/${userId}/bumps`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

/**
 * Quitar saldo. `debitedAmount` puede ser MENOR que lo pedido: el backend aplica
 * suelo en cero y descuenta lo que hay. La ficha enseña lo realmente descontado.
 */
export function debitAdminBalance(
  token: string,
  userId: string,
  moneda: 'credits' | 'bumps',
  dto: { amount: number; reason: string },
): Promise<{ balance: number; debitedAmount: number }> {
  return apiFetch(`/admin/billing/users/${userId}/${moneda}/debit`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}
