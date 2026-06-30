'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FavoriteCardButton } from './FavoriteCardButton';
import { useCardAttributes } from './CardAttributesContext';
import type { ListingSummary, PriceType } from '@/types';

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

function formatPrice(price: number, currency: string, priceType: PriceType) {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
}

function formatAttrValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const str = String(value);
  if (str === '') return '';
  return unit ? `${str} ${unit}` : str;
}

export function ListingCard({ listing }: { listing: ListingSummary }) {
  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const cardAttrDefs = useCardAttributes(listing.categorySlug);

  const cardAttrs = cardAttrDefs
    .map((def) => ({
      label: def.label,
      value: formatAttrValue(
        (listing.attributes as Record<string, unknown> | undefined)?.[def.key],
        def.unit,
      ),
    }))
    .filter((a) => a.value !== '');

  return (
    <Link href={`/anuncio/${listing.slug}`} className="group block h-full">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative aspect-square overflow-hidden bg-muted">
          {listing.thumbnailUrl ? (
            <Image
              src={listing.thumbnailUrl}
              alt={listing.title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Sin foto
            </div>
          )}
          <FavoriteCardButton listingId={listing.id} />
        </div>
        <CardContent className="p-3">
          <p className="mb-1 line-clamp-2 text-sm font-medium leading-snug">{listing.title}</p>
          <p className="text-base font-bold">{formatPrice(listing.price, listing.currency, listing.priceType)}</p>
          {cardAttrs.length > 0 && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {cardAttrs.map((a) => `${a.label}: ${a.value}`).join(' · ')}
            </p>
          )}
          {location && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{location}</p>
          )}
          {listing.status !== 'ACTIVE' && STATUS_LABELS[listing.status] && (
            <Badge
              variant={STATUS_VARIANTS[listing.status] ?? 'outline'}
              className="mt-2 text-xs"
            >
              {STATUS_LABELS[listing.status]}
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
