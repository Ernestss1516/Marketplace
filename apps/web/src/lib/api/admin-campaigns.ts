import { apiFetch } from './client';

export type CampaignType = 'CREDIT_BONUS' | 'ACTION_DISCOUNT';
export type CampaignStatus = 'upcoming' | 'live' | 'ended';
export type CreditBonusKind = 'PERCENT' | 'FIXED';
export type ActionDiscountAction = 'BUMP' | 'FEATURED';

export interface CreditBonusParams {
  kind: CreditBonusKind;
  value: number;
}

export interface ActionDiscountParams {
  action: ActionDiscountAction;
  percent: number;
}

export type CampaignParams = CreditBonusParams | ActionDiscountParams;

/**
 * Topes de cordura — mismos valores que `CampaignsService` (backend, fuente de
 * verdad: sigue validando aunque el front rechace antes). Ver comentario de
 * `CREDIT_BONUS_PERCENT_MAX`/`CREDIT_BONUS_FIXED_MAX` en `campaigns.service.ts`.
 */
export const ACTION_DISCOUNT_PERCENT_MIN = 1;
export const ACTION_DISCOUNT_PERCENT_MAX = 90;
export const CREDIT_BONUS_VALUE_MIN = 1;
export const CREDIT_BONUS_PERCENT_MAX = 500;
export const CREDIT_BONUS_FIXED_MAX = 1_000_000;

export interface AdminCampaign {
  id: string;
  name: string;
  type: CampaignType;
  active: boolean;
  startsAt: string;
  endsAt: string;
  params: CampaignParams;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminCampaigns {
  items: AdminCampaign[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateCampaignPayload {
  name: string;
  type: CampaignType;
  active?: boolean;
  startsAt: string;
  endsAt: string;
  params: CampaignParams;
}

export interface UpdateCampaignPayload {
  name?: string;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  params?: CampaignParams;
}

export function getAdminCampaigns(
  token: string,
  params: { type?: CampaignType; active?: boolean; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminCampaigns> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.type) qs.set('type', params.type);
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminCampaigns>(`/admin/campaigns?${qs}`, { token, cache: 'no-store' });
}

export function createAdminCampaign(token: string, dto: CreateCampaignPayload): Promise<AdminCampaign> {
  return apiFetch<AdminCampaign>('/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminCampaign(
  token: string,
  id: string,
  dto: UpdateCampaignPayload,
): Promise<AdminCampaign> {
  return apiFetch<AdminCampaign>(`/admin/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}
