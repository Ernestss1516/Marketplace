import type { FavoritesResponse, ListingSummary } from '@/types';
import { apiFetch } from './client';

export function checkFavorite(listingId: string, token: string): Promise<{ favorited: boolean }> {
  return apiFetch<{ favorited: boolean }>(`/favorites/${listingId}`, { token });
}

export function addFavorite(listingId: string, token: string): Promise<void> {
  return apiFetch<void>(`/favorites/${listingId}`, { method: 'POST', token });
}

export function removeFavorite(listingId: string, token: string): Promise<void> {
  return apiFetch<void>(`/favorites/${listingId}`, { method: 'DELETE', token });
}

/** Maps a raw favorites response to a frontend-consumable shape, resolving thumbnailUrl. */
function normalize(data: FavoritesResponse): { items: ListingSummary[]; total: number; page: number; pages: number } {
  return {
    ...data,
    items: data.items.map((fav) => ({
      ...fav.listing,
      thumbnailUrl: fav.listing.images[0]?.url,
    })),
  };
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
