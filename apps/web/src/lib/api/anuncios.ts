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
  CloseDealResult,
  Deal,
  ListingContact,
  ListingStatus,
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

/**
 * UXV.4 (B3) — `counts` es NUEVO: cuántos anuncios hay en cada estado, más `all` (todos
 * menos archivados, la misma regla que la vista por defecto). Lo usa `MisAnunciosClient`
 * para que las pestañas de filtro dejen de estar mudas. Es opcional en el tipo porque un
 * backend anterior al despliegue no lo manda y las pestañas deben seguir pintándose.
 */
export type MyListingsResponse = PaginatedResponse<ListingSummary> & {
  counts?: Record<string, number>;
};

export function getMyListings(
  token: string,
  opts?: { status?: string; page?: number },
): Promise<MyListingsResponse> {
  const params = new URLSearchParams({ page: String(opts?.page ?? 1) });
  if (opts?.status) params.set('status', opts.status);
  return apiFetch<MyListingsResponse>(`/users/me/listings?${params}`, { token });
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

/**
 * PUERTA regla #2 — publicar tiene ahora TRES desenlaces, no dos:
 *
 *  · `ACTIVE` — publicado.
 *  · `PENDING_REVIEW` — a revisión por el filtro de palabras (ya existía).
 *  · `DRAFT` + `publishBlocked` — NO se publicó y NO se tocó nada: el anuncio
 *    sigue tal cual estaba. Hoy sólo lo produce el correo sin verificar.
 *
 * El motivo viaja desde el backend en vez de escribirlo aquí: el texto es de
 * negocio y esta capa es presentación (ver el CLAUDE.md de apps/web).
 */
export function publishListing(
  id: string,
  token: string,
): Promise<{
  id: string;
  slug: string;
  status: 'ACTIVE' | 'PENDING_REVIEW' | 'DRAFT';
  publishedAt: string;
  publishBlocked?: { code: string; message: string; field?: string };
}> {
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

/** Ciclo de vida RÁFAGA 2 — pausa temporal (reactivable), ambos tipos. No cuenta para la cuota ni se indexa. */
export function pauseListing(id: string, token: string): Promise<{ id: string; status: 'PAUSED' }> {
  return apiFetch(`/listings/${id}/pause`, { method: 'POST', token });
}

/** Reactiva un anuncio pausado — recalcula expiresAt, respeta la cuota de activos. */
export function reactivateListing(
  id: string,
  token: string,
): Promise<{ id: string; status: 'ACTIVE'; expiresAt: string }> {
  return apiFetch(`/listings/${id}/reactivate`, { method: 'POST', token });
}

/** Archiva permanentemente (irreversible) — alternativa no destructiva a deleteListing(). */
export function archiveListing(id: string, token: string): Promise<{ id: string; status: 'ARCHIVED' }> {
  return apiFetch(`/listings/${id}/archive`, { method: 'POST', token });
}

/**
 * Ciclo de vida RÁFAGA 1 — cierra un trato, ramificado por tipo en el backend:
 * PRODUCTO se agota (→ SOLD); SERVICIO sigue ACTIVE y admite repetirse.
 * buyerId omitido = fallback "sin comprador registrado" (solo válido en
 * PRODUCTO — el backend rechaza un SERVICIO sin buyerId).
 */
export function closeDeal(
  id: string,
  buyerId: string | undefined,
  token: string,
): Promise<CloseDealResult> {
  return apiFetch<CloseDealResult>(`/listings/${id}/deals`, {
    method: 'POST',
    body: JSON.stringify(buyerId ? { buyerId } : {}),
    token,
  });
}

/** Deshace un Deal dentro de la ventana de 72h — revierte a ACTIVE si era un PRODUCTO vendido. */
export function undoDeal(
  id: string,
  dealId: string,
  token: string,
): Promise<{ id: string; status: ListingStatus }> {
  return apiFetch(`/listings/${id}/deals/${dealId}`, { method: 'DELETE', token });
}

export function getListingDeals(id: string, token: string): Promise<Deal[]> {
  return apiFetch<Deal[]>(`/listings/${id}/deals`, { token });
}

/** Contactos del anuncio (quick-pick del selector de comprador/cliente). */
export function getListingContacts(id: string, token: string): Promise<ListingContact[]> {
  return apiFetch<ListingContact[]>(`/listings/${id}/contacts`, { token });
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
