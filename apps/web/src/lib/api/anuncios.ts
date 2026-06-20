import type { Listing, ListingSummary, PaginatedResponse } from '@/types';
import { apiFetch } from './client';

export function getListing(slug: string): Promise<Listing> {
  return apiFetch<Listing>(`/listings/${slug}`);
}

export function getListingsByCategory(
  categorySlug: string,
  opts?: { page?: number; perPage?: number; sort?: string },
): Promise<PaginatedResponse<ListingSummary>> {
  const params = new URLSearchParams({
    page: String(opts?.page ?? 1),
    perPage: String(opts?.perPage ?? 24),
    sort: opts?.sort ?? 'publishedAt:desc',
  });
  return apiFetch<PaginatedResponse<ListingSummary>>(
    `/categories/${categorySlug}/listings?${params}`,
  );
}

export function getMyListings(
  token: string,
  opts?: { status?: string; page?: number },
): Promise<PaginatedResponse<ListingSummary>> {
  const params = new URLSearchParams({ page: String(opts?.page ?? 1) });
  if (opts?.status) params.set('status', opts.status);
  return apiFetch<PaginatedResponse<ListingSummary>>(`/users/me/listings?${params}`, { token });
}
