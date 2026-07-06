'use client';

import { useState, useCallback, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, PlusCircle, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MyListingCard } from './MyListingCard';
import { getMyListings } from '@/lib/api/anuncios';
import { getProStatus, type ProStatus } from '@/lib/api/billing';
import type { BumpPricing, ListingSummary } from '@/types';

const FILTERS: { label: string; value: string | null }[] = [
  { label: 'Todos', value: null },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'En revisión', value: 'PENDING_REVIEW' },
  { label: 'Borradores', value: 'DRAFT' },
  { label: 'Reservados', value: 'RESERVED' },
  { label: 'Vendidos', value: 'SOLD' },
  { label: 'Caducados', value: 'EXPIRED' },
];

interface Props {
  initialListings: ListingSummary[];
  initialProStatus: ProStatus;
  token: string;
  bumpPricing: BumpPricing;
}

export function MisAnunciosClient({ initialListings, initialProStatus, token, bumpPricing }: Props) {
  const [listings, setListings] = useState<ListingSummary[]>(initialListings);
  const [proStatus, setProStatus] = useState<ProStatus>(initialProStatus);
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
    // H8.5b: any action (destacar por cuota included) can change the remaining
    // count — refresh it here so the reminder below stays accurate without a
    // full page reload.
    getProStatus(token).then(setProStatus).catch(() => {});
  }

  const visibleListings = listings;

  return (
    <div className="space-y-6">
      {/* H8.5b — Pro quota reminder, visible without opening the destacar dialog */}
      {proStatus.isPro && proStatus.remaining > 0 && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          data-testid="quota-reminder"
        >
          <Star className="h-4 w-4 shrink-0" />
          Te quedan {proStatus.remaining} destacado{proStatus.remaining === 1 ? '' : 's'} gratis
          este mes.
        </div>
      )}

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
              bumpPricing={bumpPricing}
            />
          ))}
        </div>
      )}
    </div>
  );
}
