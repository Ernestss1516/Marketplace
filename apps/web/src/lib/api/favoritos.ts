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

/** Maps a raw favorites response to a frontend-consumable shape, resolving thumbnailUrl and categorySlug. */
function normalize(data: FavoritesResponse): { items: ListingSummary[]; total: number; page: number; pages: number } {
  return {
    ...data,
    items: data.items.map((fav) => {
      // Drop the raw `images` (Postgres ListingImage[]-shaped) before spreading — it's
      // incompatible with ListingSummary.images (Meilisearch string[] carousel URLs).
      // Favorites don't get the carousel (out of RÁFAGA 2 scope); thumbnailUrl still works.
      const { images: rawImages, category, ...rest } = fav.listing;
      return {
        ...rest,
        thumbnailUrl: rawImages[0]?.url,
        categorySlug: category?.slug,
      };
    }),
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
