'use client';

import { useSession } from 'next-auth/react';
import { Heart } from 'lucide-react';
import { useFavoritesContext } from './FavoritesGridContext';
import { useRequireAuth } from '@/hooks/use-require-auth';

interface Props {
  listingId: string;
}

export function FavoriteCardButton({ listingId }: Props) {
  const { data: session } = useSession();
  const ctx = useFavoritesContext();
  const { requireAuth } = useRequireAuth();

  // Render nothing only when there's no provider in the tree (structural) —
  // se renderiza igual para anónimos, para que descubran la función (RÁFAGA 4).
  if (!ctx) return null;
  const { isFavorited, toggleFavorite } = ctx;

  const favorited = session?.user.accessToken ? isFavorited(listingId) : false;

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!requireAuth()) return;
    void toggleFavorite(listingId);
  }

  return (
    <button
      onClick={handleClick}
      aria-label={favorited ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
    >
      <Heart
        className={`h-3.5 w-3.5 transition-colors ${
          favorited ? 'fill-favorite stroke-favorite' : 'stroke-foreground/60'
        }`}
      />
    </button>
  );
}
