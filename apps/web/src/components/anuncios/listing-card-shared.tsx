import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ListingSummary, ListingStatus, PriceType, PriceUnit } from '@/types';

const RATING_FORMAT = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Shared by ListingCard (estándar) and ListingCardWide (ampliada, RÁFAGA 2) —
// extraído para no duplicar precio/estado/resolución de fotos entre las dos.

const STATUS_LABELS: Partial<Record<string, string>> = {
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  EXPIRED: 'Caducado',
};

const STATUS_VARIANTS: Partial<Record<string, 'secondary' | 'outline'>> = {
  RESERVED: 'secondary',
  SOLD: 'outline',
  EXPIRED: 'outline',
};

/** Sufijo que se añade al precio según su formato (RP.4b). ONE_TIME es cadena
 *  vacía: un pago único se sigue mostrando "200 €" a secas, exactamente como
 *  antes de esta ráfaga. */
const UNIT_SUFFIX: Record<PriceUnit, string> = {
  ONE_TIME: '',
  PER_MONTH: '/mes',
  PER_WEEK: '/semana',
  PER_DAY: '/día',
  PER_HOUR: '/hora',
  PER_UNIT: '/ud.',
  PER_SESSION: '/sesión',
};

/**
 * Precio tal y como lo ve el comprador (RP.4b).
 *
 * Los dos ejes se combinan, no se excluyen — por eso NEGOTIABLE no puede hacer
 * un `return` temprano como FREE: "a convenir, al mes" es un caso real de
 * alquiler y debe leerse "A convenir/mes". Solo FREE sale sin sufijo: un
 * anuncio gratis no se cobra por hora ni por mes, así que "Gratis" es la
 * lectura completa.
 *
 * `priceUnit` lleva default ONE_TIME a propósito: toda llamada anterior a RP.4b
 * (y todo anuncio anterior a RP.1) sigue compilando y renderizando idéntica.
 */
export function formatListingPrice(
  price: number,
  currency: string,
  priceType: PriceType,
  priceUnit: PriceUnit = 'ONE_TIME',
): string {
  if (priceType === 'FREE') return 'Gratis';
  const suffix = UNIT_SUFFIX[priceUnit] ?? '';
  if (priceType === 'NEGOTIABLE') return `A convenir${suffix}`;
  const amount = new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
  return `${amount}${suffix}`;
}

export function ListingStatusBadge({ status, className }: { status: ListingStatus; className?: string }) {
  if (status === 'ACTIVE' || !STATUS_LABELS[status]) return null;
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'outline'} className={className ?? 'mt-2 text-xs'}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Fotos a pasar a CardPhotoCarousel. `images` (Meilisearch, RÁFAGA 2) trae el
 * array completo; el fallback Postgres (categoría sin Meili, ver H6.2) solo
 * trae `thumbnailUrl` — en ese caso se ofrece como carrusel de una sola foto
 * (sin flechas, ya que CardPhotoCarousel solo las muestra con >1 imagen).
 */
export function getListingPhotos(listing: ListingSummary): string[] {
  if (listing.images?.length) return listing.images;
  return listing.thumbnailUrl ? [listing.thumbnailUrl] : [];
}

export function buildListingLocation(listing: ListingSummary): string {
  return [listing.city, listing.province].filter(Boolean).join(', ');
}

/**
 * Escaparate RÁFAGA 4 — reputación del vendedor donde el comprador decide.
 * `count` en 0 (o `average` null, misma señal que ya usa el perfil) → "Nuevo",
 * nunca ★0,0: un vendedor sin valoraciones VERIFICADAS no es lo mismo que uno
 * mal valorado. Sin Link propio a propósito — la card entera ya es un Link a
 * /anuncio/[slug] (no se puede anidar otro); en la ficha, SellerCard ya
 * envuelve su contenido en el Link a /vendedor/[slug].
 */
export function SellerRatingInline({
  average,
  count,
  detailed = false,
}: {
  average: number | null | undefined;
  count: number | undefined;
  /** true en la ficha (más detalle: nº de valoraciones); false en la card (solo la media). */
  detailed?: boolean;
}) {
  if (!count) {
    return <span className="text-xs text-muted-foreground">Nuevo</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <span className="font-medium text-foreground">{RATING_FORMAT.format(average ?? 0)}</span>
      {detailed && (
        <span>
          · {count} {count === 1 ? 'valoración' : 'valoraciones'}
        </span>
      )}
    </span>
  );
}
