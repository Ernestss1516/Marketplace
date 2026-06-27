'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Heart } from 'lucide-react';
import { checkFavorite, addFavorite, removeFavorite } from '@/lib/api/favoritos';
import { useApiAction } from '@/lib/api/use-api-action';

interface Props {
  listingId: string;
}

export function FavoriteButton({ listingId }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = session?.user.accessToken;

  const [favorited, setFavorited] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    checkFavorite(listingId, token)
      .then(({ favorited: initial }) => setFavorited(initial))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [listingId, token]);

  if (!token) return null;

  async function toggle() {
    if (!token || loading) return;
    setLoading(true);
    const next = !favorited;
    setFavorited(next); // optimistic
    await run(
      () => next ? addFavorite(listingId, token!) : removeFavorite(listingId, token!),
      {
        // On non-auth error: rollback the optimistic update; auth error: signOut + redirect
        onError: () => setFavorited(!next),
      },
    );
    setLoading(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={loading || !ready}
      aria-label={favorited ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      <Heart
        className={`h-4 w-4 transition-colors ${
          favorited ? 'fill-red-500 stroke-red-500' : 'stroke-muted-foreground'
        }`}
      />
      <span>{favorited ? 'Guardado' : 'Guardar'}</span>
    </button>
  );
}
