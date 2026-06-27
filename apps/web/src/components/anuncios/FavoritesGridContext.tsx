'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSession } from 'next-auth/react';
import { addFavorite, batchCheckFavorites, removeFavorite } from '@/lib/api/favoritos';
import { useApiAction } from '@/lib/api/use-api-action';

interface FavoritesGridContextValue {
  isFavorited: (id: string) => boolean;
  toggleFavorite: (id: string) => Promise<void>;
}

const FavoritesGridContext = createContext<FavoritesGridContextValue | null>(null);

export function useFavoritesContext(): FavoritesGridContextValue | null {
  return useContext(FavoritesGridContext);
}

interface ProviderProps {
  listingIds: string[];
  /** Pre-seed the set when the caller already knows all items are favorited (e.g. /favoritos). */
  initialFavoritedIds?: string[];
  /** Called optimistically when an item is unfavorited. */
  onUnfavorite?: (listingId: string) => void;
  /** Called when the DELETE request fails, to roll back the parent's optimistic removal. */
  onUnfavoriteRollback?: (listingId: string) => void;
  children: React.ReactNode;
}

export function FavoritesGridProvider({
  listingIds,
  initialFavoritedIds,
  onUnfavorite,
  onUnfavoriteRollback,
  children,
}: ProviderProps) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = session?.user.accessToken;

  const [favoritedSet, setFavoritedSet] = useState<Set<string>>(
    () => new Set(initialFavoritedIds ?? []),
  );

  // Batch-check on mount when token is available and no pre-seeded state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!token || initialFavoritedIds !== undefined || listingIds.length === 0) return;
    batchCheckFavorites(listingIds, token)
      .then(({ favoritedIds }) => setFavoritedSet(new Set(favoritedIds)))
      .catch(() => {});
  }, [token, initialFavoritedIds]); // intentionally excludes listingIds — fetch once per session

  const toggleFavorite = useCallback(
    async (id: string) => {
      if (!token) return;
      const wasFavorited = favoritedSet.has(id);

      // Optimistic update
      setFavoritedSet((prev) => {
        const s = new Set(prev);
        wasFavorited ? s.delete(id) : s.add(id);
        return s;
      });
      if (wasFavorited) onUnfavorite?.(id);

      await run(
        () => wasFavorited ? removeFavorite(id, token) : addFavorite(id, token),
        {
          onError: () => {
            // Rollback on non-auth error; auth error (401) → signOut via hook
            setFavoritedSet((prev) => {
              const s = new Set(prev);
              wasFavorited ? s.add(id) : s.delete(id);
              return s;
            });
            if (wasFavorited) onUnfavoriteRollback?.(id);
          },
        },
      );
    },
    [token, favoritedSet, onUnfavorite, onUnfavoriteRollback, run],
  );

  const value = useMemo<FavoritesGridContextValue>(
    () => ({
      isFavorited: (id: string) => favoritedSet.has(id),
      toggleFavorite,
    }),
    [favoritedSet, toggleFavorite],
  );

  return (
    <FavoritesGridContext.Provider value={value}>
      {children}
    </FavoritesGridContext.Provider>
  );
}
