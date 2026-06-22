import type {
  Listing,
  ListingSummary,
  MyListing,
  PaginatedResponse,
  CreateListingPayload,
  UpdateListingPayload,
  CreatedListing,
} from '@/types';
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

export function getRecentListings(
  opts?: { page?: number; perPage?: number },
): Promise<PaginatedResponse<ListingSummary>> {
  const params = new URLSearchParams({
    page: String(opts?.page ?? 1),
    perPage: String(opts?.perPage ?? 8),
  });
  return apiFetch<PaginatedResponse<ListingSummary>>(`/listings?${params}`);
}

export function getListingsBySellerSlug(
  sellerSlug: string,
  opts?: { page?: number; perPage?: number },
): Promise<PaginatedResponse<ListingSummary>> {
  const params = new URLSearchParams({
    page: String(opts?.page ?? 1),
    perPage: String(opts?.perPage ?? 24),
  });
  return apiFetch<PaginatedResponse<ListingSummary>>(
    `/users/${sellerSlug}/listings?${params}`,
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

export function createListing(
  payload: CreateListingPayload,
  token: string,
): Promise<CreatedListing> {
  return apiFetch<CreatedListing>('/listings', {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
  });
}

export function publishListing(
  id: string,
  token: string,
): Promise<{ id: string; slug: string; status: 'ACTIVE'; publishedAt: string }> {
  return apiFetch(`/listings/${id}/publish`, { method: 'POST', token });
}

export function getMyListingById(id: string, token: string): Promise<MyListing> {
  return apiFetch<MyListing>(`/listings/mine/${id}`, { token });
}

export function updateListing(
  id: string,
  payload: UpdateListingPayload,
  token: string,
): Promise<MyListing> {
  return apiFetch<MyListing>(`/listings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token,
  });
}

export function reserveListing(id: string, token: string): Promise<{ id: string; status: 'RESERVED' }> {
  return apiFetch(`/listings/${id}/reserve`, { method: 'POST', token });
}

export function markListingSold(id: string, token: string): Promise<{ id: string; status: 'SOLD' }> {
  return apiFetch(`/listings/${id}/sold`, { method: 'POST', token });
}

export function deleteListing(id: string, token: string): Promise<void> {
  return apiFetch(`/listings/${id}`, { method: 'DELETE', token });
}

export function renewListing(
  id: string,
  token: string,
): Promise<{ id: string; status: 'ACTIVE'; expiresAt: string }> {
  return apiFetch(`/listings/${id}/renew`, { method: 'POST', token });
}
