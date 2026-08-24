import type { FavoritesResponse, ListingSummary } from '@/types';
import { apiFetch } from './client';

export function batchCheckFavorites(
  listingIds: string[],
  token: string,
): Promise<{ favoritedIds: string[] }> {
  return apiFetch<{ favoritedIds: string[] }>('/favorites/batch-check', {
    method: 'POST',
    body: JSON.stringify({ listingIds }),
    token,
  });
}

export function checkFavorite(listingId: string, token: string): Promise<{ favorited: boolean }> {
  return apiFetch<{ favorited: boolean }>(`/favorites/${listingId}`, { token });
}

export function addFavorite(listingId: string, token: string): Promise<void> {
  return apiFetch<void>(`/favorites/${listingId}`, { method: 'POST', token });
}

export function removeFavorite(listingId: string, token: string): Promise<void> {
  return apiFetch<void>(`/favorites/${listingId}`, { method: 'DELETE', token });
}

/**
 * Desenvuelve el anuncio de cada favorito. Y ya no hace nada más, que es el resultado
 * visible del arreglo de la fuga: la API servía la FILA CRUDA del anuncio (con `phone`
 * dentro) y aquí se remendaba a mano `thumbnailUrl` y `categorySlug` a partir de las
 * relaciones en bruto. Ahora `/favorites` pasa por el mismo `toSummary` que las otras diez
 * listas, así que lo que llega **ya es** un `ListingSummary` — con `thumbnailUrl`,
 * `categorySlug`, `hasVideo` y la media del vendedor ya resueltos en el servidor.
 *
 * Que este mapeo se haya quedado en una línea NO es cosmético: mientras el frontend
 * reconstruía la forma segura, la insegura viajaba entera por la red.
 */
function normalize(data: FavoritesResponse): { items: ListingSummary[]; total: number; page: number; pages: number } {
  return { ...data, items: data.items.map((fav) => fav.listing) };
}

export async function getMyFavorites(
  token: string,
  page = 1,
  perPage = 20,
): Promise<{ items: ListingSummary[]; total: number; page: number; pages: number }> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  const data = await apiFetch<FavoritesResponse>(`/favorites?${params}`, { token });
  return normalize(data);
}
