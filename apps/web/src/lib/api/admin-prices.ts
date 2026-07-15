import { apiFetch } from './client';

export interface AdminPrice {
  id: string;
  label: string;
  amount: number;
  currency: string;
  durationDays: number | null;
  active: boolean;
  creditPackId: string | null;
  creditAmount: number | null;
  /** Monetización ráfaga 2 — solo relevante cuando creditPackId != null. */
  highlightBumps: boolean | null;
}

export function getAdminPrices(token: string): Promise<AdminPrice[]> {
  return apiFetch<AdminPrice[]>('/admin/billing/prices', { token, cache: 'no-store' });
}

export function updateAdminPrice(token: string, id: string, amount: number): Promise<AdminPrice> {
  return apiFetch<AdminPrice>(`/admin/billing/prices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount }),
    token,
  });
}

export function updateAdminCreditPackAmount(
  token: string,
  creditPackId: string,
  creditAmount: number,
  highlightBumps?: boolean,
): Promise<AdminPrice> {
  return apiFetch<AdminPrice>(`/admin/billing/credit-packs/${creditPackId}`, {
    method: 'PATCH',
    body: JSON.stringify({ creditAmount, ...(highlightBumps !== undefined && { highlightBumps }) }),
    token,
  });
}
