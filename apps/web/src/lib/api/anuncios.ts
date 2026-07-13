import type {
  Listing,
  ListingSummary,
  ListingStats,
  ListingStatsSummary,
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

/**
 * H8 Bloque C2 — dispara el tracking de una vista. Silencioso a propósito: el
 * llamador (ListingViewTracker) ignora el resultado y los errores, el tracking
 * nunca debe afectar la experiencia de ver la ficha. token es opcional — un
 * visitante anónimo también cuenta (ver diseño en el backend).
 */
export function trackListingView(slug: string, token?: string): Promise<void> {
  return apiFetch<void>(`/listings/${slug}/view`, { method: 'POST', token });
}

/**
 * "Ver teléfono" — requiere sesión. El número solo se sirve por esta vía
 * autenticada; NUNCA viaja en el payload de getListing() (ver diseño en el
 * backend, ListingsService.findBySlug).
 */
export function getListingPhone(id: string, token: string): Promise<{ phone: string }> {
  return apiFetch<{ phone: string }>(`/listings/${id}/phone`, { token });
}

/** Básico para todos los dueños; enriquecido (dailyViews, likeRatio) si el dueño es Pro. */
export function getMineStats(id: string, token: string): Promise<ListingStats> {
  return apiFetch<ListingStats>(`/listings/mine/${id}/stats`, { token });
}

/** Agregado de todos los anuncios del vendedor — solo Pro (403 si no). */
export function getMineStatsSummary(token: string): Promise<ListingStatsSummary> {
  return apiFetch<ListingStatsSummary>('/listings/mine/stats/summary', { token });
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
): Promise<{ id: string; slug: string; status: 'ACTIVE' | 'PENDING_REVIEW'; publishedAt: string }> {
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
