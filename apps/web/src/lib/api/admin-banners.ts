import { apiFetch } from './client';
import type { BannerPlacement, BannerVariant } from './banners';

export type BannerStatus = 'upcoming' | 'live' | 'ended';

export interface AdminBanner {
  id: string;
  title: string;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  placements: BannerPlacement[];
  variant: BannerVariant;
  shareable: boolean;
  shareText: string | null;
  active: boolean;
  startsAt: string;
  endsAt: string;
  status: BannerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminBanners {
  items: AdminBanner[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateBannerPayload {
  title: string;
  text: string;
  linkUrl?: string;
  linkText?: string;
  placements: BannerPlacement[];
  variant?: BannerVariant;
  shareable?: boolean;
  shareText?: string;
  active?: boolean;
  startsAt: string;
  endsAt: string;
}

export interface UpdateBannerPayload {
  title?: string;
  text?: string;
  linkUrl?: string | null;
  linkText?: string | null;
  placements?: BannerPlacement[];
  variant?: BannerVariant;
  shareable?: boolean;
  shareText?: string | null;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
}

export function getAdminBanners(
  token: string,
  params: { placement?: BannerPlacement; active?: boolean; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminBanners> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.placement) qs.set('placement', params.placement);
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminBanners>(`/admin/banners?${qs}`, { token, cache: 'no-store' });
}

export function createAdminBanner(token: string, dto: CreateBannerPayload): Promise<AdminBanner> {
  return apiFetch<AdminBanner>('/admin/banners', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminBanner(
  token: string,
  id: string,
  dto: UpdateBannerPayload,
): Promise<AdminBanner> {
  return apiFetch<AdminBanner>(`/admin/banners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}
