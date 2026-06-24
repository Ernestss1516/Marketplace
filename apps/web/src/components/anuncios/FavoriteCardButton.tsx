'use client';

import { useSession } from 'next-auth/react';
import { Heart } from 'lucide-react';
import { useFavoritesContext } from './FavoritesGridContext';

interface Props {
  listingId: string;
}

export function FavoriteCardButton({ listingId }: Props) {
  const { data: session } = useSession();
  const ctx = useFavoritesContext();

  // Render nothing when not authenticated or when no provider is in the tree.
  if (!session?.user.accessToken || !ctx) return null;

  const { isFavorited, toggleFavorite } = ctx;
  const favorited = isFavorited(listingId);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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
          favorited ? 'fill-red-500 stroke-red-500' : 'stroke-foreground/60'
        }`}
      />
    </button>
  );
}
