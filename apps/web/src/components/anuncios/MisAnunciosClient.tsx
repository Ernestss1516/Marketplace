'use client';

import { useState, useCallback, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, PlusCircle, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MyListingCard } from './MyListingCard';
import { getMyListings } from '@/lib/api/anuncios';
import { getProStatus, getWallet, type ProStatus } from '@/lib/api/billing';
import type { BumpPricing, ListingSummary } from '@/types';

// "Todos" (value: null) es "sin filtro explícito" — el backend (findMine) ya
// excluye ARCHIVED de esa vista por defecto (ciclo de vida RÁFAGA 2); PAUSED
// sí aparece en "Todos", solo ARCHIVED necesita su propia pestaña.
const FILTERS: { label: string; value: string | null }[] = [
  { label: 'Todos', value: null },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'En revisión', value: 'PENDING_REVIEW' },
  { label: 'Borradores', value: 'DRAFT' },
  { label: 'Reservados', value: 'RESERVED' },
  { label: 'Pausados', value: 'PAUSED' },
  { label: 'Vendidos', value: 'SOLD' },
  { label: 'Caducados', value: 'EXPIRED' },
  { label: 'Archivados', value: 'ARCHIVED' },
];

interface Props {
  initialListings: ListingSummary[];
  initialProStatus: ProStatus;
  token: string;
  bumpPricing: BumpPricing;
  /** UXV.4 (B3) — recuento por estado, servido por la misma llamada que los anuncios. */
  initialCounts?: Record<string, number>;
}

export function MisAnunciosClient({
  initialListings,
  initialProStatus,
  token,
  bumpPricing: initialBumpPricing,
  initialCounts,
}: Props) {
  const [listings, setListings] = useState<ListingSummary[]>(initialListings);
  const [counts, setCounts] = useState<Record<string, number> | undefined>(initialCounts);
  const [proStatus, setProStatus] = useState<ProStatus>(initialProStatus);
  const [bumpPricing, setBumpPricing] = useState<BumpPricing>(initialBumpPricing);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refetch = useCallback(
    (status: string | null) => {
      startTransition(async () => {
        const result = await getMyListings(token, status ? { status } : undefined);
        setListings(result.items);
        // Los recuentos vienen con CADA respuesta, así que se refrescan solos tras
        // publicar, pausar o archivar: si no, las pestañas quedarían mintiendo.
        if (result.counts) setCounts(result.counts);
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
    getProStatus(token)
      .then((status) => {
        setProStatus(status);
        // Monetización ráfaga 3: un bump puede haber consumido cuota mensual
        // Pro — refresca bumpQuota junto con el resto de pro-status (mismo
        // origen, una sola petición).
        setBumpPricing((prev) => ({ ...prev, bumpQuota: status.bumpQuota }));
      })
      .catch(() => {});
    // Monetización ráfaga 2: un bump puede haber consumido saldo de bumps —
    // refresca para que el botón refleje el saldo real en el siguiente render,
    // mismo patrón que proStatus arriba.
    getWallet(token)
      .then((wallet) => setBumpPricing((prev) => ({ ...prev, bumpBalance: wallet.bumpBalance })))
      .catch(() => {});
  }

  const visibleListings = listings;

  return (
    <div className="space-y-6">
      {/*
        H8.5b — recordatorio de cuota Pro, sin tener que abrir el diálogo de destacar.
        UXV.6 (M12) — se enseña TAMBIÉN agotada, y con LAS DOS cuotas.

        Antes la condición era `isPro && remaining > 0`: al gastar el último destacado el
        aviso desaparecía, y desde fuera «no soy Pro» y «ya la gasté» se veían exactamente
        igual — ninguna de las dos decía nada. Y la cuota de BUMPS no se veía en ninguna
        parte salvo incrustada en el texto de un botón.
      */}
      {proStatus.isPro && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          data-testid="quota-reminder"
        >
          <span className="flex items-center gap-2">
            <Star className="h-4 w-4 shrink-0" aria-hidden />
            {proStatus.remaining > 0
              ? `Te quedan ${proStatus.remaining} destacado${proStatus.remaining === 1 ? '' : 's'} gratis este mes.`
              : 'Has usado tus destacados gratis de este mes.'}
          </span>
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 shrink-0" aria-hidden />
            {proStatus.bumpQuota.remaining > 0
              ? `Y ${proStatus.bumpQuota.remaining} bump${proStatus.bumpQuota.remaining === 1 ? '' : 's'} gratis.`
              : 'Y ningún bump gratis disponible.'}
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-4">
        {FILTERS.map((f) => {
          // UXV.4 (B3) — nueve pestañas mudas obligaban a pincharlas una a una para saber
          // qué había detrás. `undefined` (backend viejo o dato ausente) NO pinta un 0:
          // un cero falso es peor que no decir nada.
          const n = counts?.[f.value ?? 'all'];
          return (
            <button
              key={String(f.value)}
              onClick={() => handleFilterChange(f.value)}
              aria-current={activeFilter === f.value ? 'true' : undefined}
              className={[
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                activeFilter === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              ].join(' ')}
            >
              {f.label}
              {n !== undefined && (
                <span
                  className={[
                    'ml-1.5 tabular-nums',
                    activeFilter === f.value ? 'opacity-80' : 'opacity-60',
                  ].join(' ')}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
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
