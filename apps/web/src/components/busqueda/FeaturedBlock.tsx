import { Sparkles } from 'lucide-react';
import { ListingCard } from '@/components/anuncios/ListingCard';
import type { ListingSummary } from '@/types';

/**
 * Bloque "Promocionados" (política de ordenación C, RÁFAGA 1): destacados que
 * cumplen los filtros actuales, mostrados en un bloque marcado ARRIBA de la
 * lista. Se repiten a propósito en su posición natural dentro de `hits` — el
 * bloque es la vitrina de pago, la lista sigue siendo la lista real ordenada
 * como el usuario pidió (boostScore ya no la reordena).
 */
export function FeaturedBlock({ listings }: { listings: ListingSummary[] }) {
  if (listings.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Anuncios promocionados">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-amber-700">
        <Sparkles className="h-4 w-4" aria-hidden />
        Promocionados
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={`featured-${listing.id}`} listing={listing} />
        ))}
      </div>
    </section>
  );
}
