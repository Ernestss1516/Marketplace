import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { FeaturedBadge } from './FeaturedBadge';
import { FavoriteCardButton } from './FavoriteCardButton';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { CardAttrsDisplay } from './CardAttributesContext';
import {
  formatListingPrice,
  getListingPhotos,
  buildListingLocation,
  ListingStatusBadge,
  SellerRatingInline,
} from './listing-card-shared';
import type { ListingSummary } from '@/types';

export function ListingCard({
  listing,
  /** Primeras cards de la parrilla (above the fold) — prioriza su descarga. */
  priority = false,
}: {
  listing: ListingSummary;
  priority?: boolean;
}) {
  const location = buildListingLocation(listing);
  const photos = getListingPhotos(listing);

  return (
    // prefetch={false}: mitigación del bug conocido del App Router de Next 15
    // (vercel/next.js#57565, sin fix upstream a fecha de esta investigación) — una
    // parrilla con muchas tarjetas dispara una ráfaga de prefetches concurrentes al
    // mismo patrón dinámico /anuncio/[slug] que puede dejar el router cliente
    // wedged (clicks posteriores no navegan). En una parrilla de resultados el
    // prefetch-on-viewport rinde poco de todos modos (se prefetchean destinos que
    // el usuario no visita), así que el coste de desactivarlo es mínimo.
    <Link href={`/anuncio/${listing.slug}`} className="group block h-full" prefetch={false}>
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <CardPhotoCarousel
          images={photos}
          title={listing.title}
          hasVideo={listing.hasVideo}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          priority={priority}
        >
          {listing.boostScore === 1 && <FeaturedBadge />}
          <FavoriteCardButton listingId={listing.id} />
        </CardPhotoCarousel>
        <CardContent className="p-3">
          <p className="mb-1 line-clamp-2 text-sm font-medium leading-snug">{listing.title}</p>
          <p className="text-base font-bold">{formatListingPrice(listing.price, listing.currency, listing.priceType, listing.priceUnit)}</p>
          <CardAttrsDisplay
            categorySlug={listing.categorySlug}
            attributes={listing.attributes as Record<string, unknown> | undefined}
            listingType={listing.type}
          />
          <div className="mt-1 flex items-center gap-2">
            {location && (
              <p className="truncate text-xs text-muted-foreground">{location}</p>
            )}
            <SellerRatingInline average={listing.sellerRatingAverage} count={listing.sellerRatingCount} />
          </div>
          <ListingStatusBadge status={listing.status} />
        </CardContent>
      </Card>
    </Link>
  );
}
