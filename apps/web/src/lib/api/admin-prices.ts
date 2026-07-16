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
  /** Monetización ráfaga 4 — solo presente cuando el Price es de un BumpPack. */
  bumpPackId: string | null;
  bumpAmount: number | null;
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
): Promise<AdminPrice> {
  return apiFetch<AdminPrice>(`/admin/billing/credit-packs/${creditPackId}`, {
    method: 'PATCH',
    body: JSON.stringify({ creditAmount }),
    token,
  });
}

/** Monetización ráfaga 4 — mismo molde que updateAdminCreditPackAmount, moneda distinta. */
export function updateAdminBumpPackAmount(
  token: string,
  bumpPackId: string,
  bumpAmount: number,
): Promise<AdminPrice> {
  return apiFetch<AdminPrice>(`/admin/billing/bump-packs/${bumpPackId}`, {
    method: 'PATCH',
    body: JSON.stringify({ bumpAmount }),
    token,
  });
}
