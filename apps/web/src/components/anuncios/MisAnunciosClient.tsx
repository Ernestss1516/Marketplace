'use client';

import { useState, useCallback, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MyListingCard } from './MyListingCard';
import { getMyListings } from '@/lib/api/anuncios';
import type { ListingSummary } from '@/types';

const FILTERS: { label: string; value: string | null }[] = [
  { label: 'Todos', value: null },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'Borradores', value: 'DRAFT' },
  { label: 'Reservados', value: 'RESERVED' },
  { label: 'Vendidos', value: 'SOLD' },
];

interface Props {
  initialListings: ListingSummary[];
  token: string;
}

export function MisAnunciosClient({ initialListings, token }: Props) {
  const [listings, setListings] = useState<ListingSummary[]>(initialListings);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refetch = useCallback(
    (status: string | null) => {
      startTransition(async () => {
        const result = await getMyListings(token, status ? { status } : undefined);
        setListings(result.items);
      });
    },
    [token],
  );

  function handleFilterChange(value: string | null) {
    setActiveFilter(value);
    refetch(value);
  }

  function handleAction() {
    refetch(activeFilter);
  }

  const visibleListings = listings;

  return (
    <div className="space-y-6">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-4">
        {FILTERS.map((f) => (
          <button
            key={String(f.value)}
            onClick={() => handleFilterChange(f.value)}
            className={[
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              activeFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
        {isPending && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
      </div>

      {/* Listing grid */}
      {visibleListings.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">
            {activeFilter
              ? 'No tienes anuncios con este estado.'
              : 'Aún no has publicado ningún anuncio.'}
          </p>
          <Button asChild>
            <Link href="/publicar">
              <PlusCircle className="mr-2 h-4 w-4" />
              Publicar anuncio
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2">
          {visibleListings.map((listing) => (
            <MyListingCard
              key={listing.id}
              listing={listing}
              token={token}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
