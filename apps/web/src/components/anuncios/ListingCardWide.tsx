import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FavoriteCardButton } from './FavoriteCardButton';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { WideCardAttrsDisplay } from './CardAttributesContext';
import { TruncatedDescription } from './TruncatedDescription';
import { formatListingPrice, getListingPhotos, buildListingLocation, ListingStatusBadge } from './listing-card-shared';
import type { ListingSummary } from '@/types';

/**
 * Vista AMPLIADA (RÁFAGA 2): una columna, card ancha — foto a la izquierda
 * (fija en desktop, arriba en móvil), contenido a la derecha con hasta 6
 * atributos (WideCardAttrsDisplay) y descripción parcial/entera. Reutiliza
 * CardPhotoCarousel/FavoriteCardButton/badges/helpers de ListingCard — la
 * diferencia es puramente de layout y densidad de información.
 */
export function ListingCardWide({
  listing,
  priority = false,
}: {
  listing: ListingSummary;
  priority?: boolean;
}) {
  const location = buildListingLocation(listing);
  const photos = getListingPhotos(listing);

  return (
    <Link href={`/anuncio/${listing.slug}`} className="group block" prefetch={false}>
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="flex flex-col sm:flex-row">
          <div className="sm:w-64 sm:shrink-0">
            <CardPhotoCarousel
              images={photos}
              title={listing.title}
              aspectClassName="aspect-[4/3] sm:aspect-square"
              sizes="(max-width: 640px) 100vw, 256px"
              priority={priority}
            >
              {listing.boostScore === 1 && (
                <Badge className="absolute left-2 top-2 bg-amber-500 text-white hover:bg-amber-500">
                  Destacado
                </Badge>
              )}
              <FavoriteCardButton listingId={listing.id} />
            </CardPhotoCarousel>
          </div>

          <CardContent className="flex-1 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-base font-semibold leading-snug">{listing.title}</p>
              <p className="shrink-0 text-lg font-bold">
                {formatListingPrice(listing.price, listing.currency, listing.priceType)}
              </p>
            </div>
            {location && (
              <p className="mt-0.5 text-xs text-muted-foreground">{location}</p>
            )}
            <WideCardAttrsDisplay
              categorySlug={listing.categorySlug}
              attributes={listing.attributes as Record<string, unknown> | undefined}
              listingType={listing.type}
            />
            <TruncatedDescription text={listing.description} />
            <ListingStatusBadge status={listing.status} />
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}
