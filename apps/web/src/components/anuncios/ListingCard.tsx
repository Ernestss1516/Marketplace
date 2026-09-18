import Link from 'next/link';
import { FeaturedBadge } from './FeaturedBadge';
import { FavoriteCardButton } from './FavoriteCardButton';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { GridCardShell, GRID_MEDIA_SIZES } from './card-shells';
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
      {/* El molde (caja, gesto `.tarjeta-levanta` del ESCAPARATE C, columna de contenido)
          vive en `card-shells.tsx` desde que el patrocinado intercalado tuvo que usar
          EXACTAMENTE el mismo — antes lo escribía cada tarjeta a mano y el patrocinado se
          quedó con otro. Aquí sólo va lo que es de un anuncio. */}
      <GridCardShell
        media={
          <CardPhotoCarousel
            images={photos}
            title={listing.title}
            hasVideo={listing.hasVideo}
            videoPreviewUrl={listing.videoPreviewUrl}
            sizes={GRID_MEDIA_SIZES}
            priority={priority}
          >
            {listing.boostScore === 1 && <FeaturedBadge />}
            <FavoriteCardButton listingId={listing.id} />
          </CardPhotoCarousel>
        }
      >
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
      </GridCardShell>
    </Link>
  );
}
