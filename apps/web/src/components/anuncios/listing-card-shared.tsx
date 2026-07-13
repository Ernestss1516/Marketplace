import { Badge } from '@/components/ui/badge';
import type { ListingSummary, ListingStatus, PriceType } from '@/types';

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

export function formatListingPrice(price: number, currency: string, priceType: PriceType): string {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
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
