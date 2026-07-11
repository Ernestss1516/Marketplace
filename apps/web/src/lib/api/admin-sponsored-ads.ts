import { apiFetch } from './client';

export type SponsoredAdStatus = 'upcoming' | 'live' | 'ended';

export interface AdminSponsoredAd {
  id: string;
  imageUrl: string;
  title: string;
  description: string;
  targetUrl: string;
  categoryId: string;
  category: { name: string; slug: string };
  order: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  status: SponsoredAdStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminSponsoredAds {
  items: AdminSponsoredAd[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateSponsoredAdPayload {
  imageUrl: string;
  title: string;
  description: string;
  targetUrl: string;
  categoryId: string;
  order?: number;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
}

export interface UpdateSponsoredAdPayload {
  imageUrl?: string;
  title?: string;
  description?: string;
  targetUrl?: string;
  categoryId?: string;
  order?: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export function getAdminSponsoredAds(
  token: string,
  params: { categoryId?: string; active?: boolean; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminSponsoredAds> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.categoryId) qs.set('categoryId', params.categoryId);
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminSponsoredAds>(`/admin/sponsored-ads?${qs}`, { token, cache: 'no-store' });
}

export function createAdminSponsoredAd(
  token: string,
  dto: CreateSponsoredAdPayload,
): Promise<AdminSponsoredAd> {
  return apiFetch<AdminSponsoredAd>('/admin/sponsored-ads', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminSponsoredAd(
  token: string,
  id: string,
  dto: UpdateSponsoredAdPayload,
): Promise<AdminSponsoredAd> {
  return apiFetch<AdminSponsoredAd>(`/admin/sponsored-ads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function uploadSponsoredAdImage(token: string, file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<{ url: string }>('/admin/sponsored-ads/upload-image', {
    method: 'POST',
    body,
    token,
  });
}
