'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IlustracionImagen } from '@/components/shared/IlustracionImagen';
import type { IlustracionResuelta } from '@/lib/ilustraciones';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import type { ListingSummary } from '@/types';

interface Props {
  initialListings: ListingSummary[];
  totalInitial: number;
  page: number;
  pages: number;
}

export function FavoritosClient({
  initialListings,
  totalInitial,
  page,
  pages,
  ilustracionVacio,
}: Props & { ilustracionVacio: IlustracionResuelta | null }) {
  // Track removed IDs separately so rollback is a simple Set.delete().
  // Visible listings = initialListings filtered by removedIds.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const visibleListings = initialListings.filter((l) => !removedIds.has(l.id));
  const visibleTotal = totalInitial - removedIds.size;

  function handleUnfavorite(id: string) {
    setRemovedIds((prev) => new Set([...prev, id]));
  }

  function handleUnfavoriteRollback(id: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  if (visibleListings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center text-muted-foreground">
        {/* E7 — la MISMA ilustración que pinta el servidor cuando la lista llega
            vacía. Aquí llega por prop porque este componente es de cliente y
            `Ilustracion` es un Server Component: quitar el último favorito sin
            recargar no puede dejar un hueco distinto del que se ve al entrar. */}
        <IlustracionImagen ilustracion={ilustracionVacio} />
        <p className="text-base">Aún no tienes anuncios guardados.</p>
        <Button variant="outline" asChild>
          <Link href="/busqueda">Explorar anuncios</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {visibleTotal} {visibleTotal === 1 ? 'anuncio guardado' : 'anuncios guardados'}
      </p>

      <FavoritesGridProvider
        listingIds={initialListings.map((l) => l.id)}
        initialFavoritedIds={initialListings.map((l) => l.id)}
        onUnfavorite={handleUnfavorite}
        onUnfavoriteRollback={handleUnfavoriteRollback}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleListings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </FavoritesGridProvider>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/favoritos?page=${page - 1}`}>Anterior</Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          {page < pages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/favoritos?page=${page + 1}`}>Siguiente</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
