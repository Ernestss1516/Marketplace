import Link from 'next/link';
import { FeaturedBadge } from './FeaturedBadge';
import { FavoriteCardButton } from './FavoriteCardButton';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { WideCardShell, WIDE_MEDIA_ASPECT, WIDE_MEDIA_SIZES } from './card-shells';
import { WideCardAttrsDisplay } from './CardAttributesContext';
import { TruncatedDescription } from './TruncatedDescription';
import {
  formatListingPrice,
  getListingPhotos,
  buildListingLocation,
  ListingStatusBadge,
  SellerRatingInline,
} from './listing-card-shared';
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
      {/* El molde lo pone `WideCardShell` (ver `card-shells.tsx`): es el mismo que usa el
          patrocinado intercalado en esta misma lista, y ésa es exactamente la razón de que
          esté fuera. Aquí queda lo que sólo tiene un anuncio. */}
      <WideCardShell
        media={
          <CardPhotoCarousel
            images={photos}
            title={listing.title}
            aspectClassName={WIDE_MEDIA_ASPECT}
            hasVideo={listing.hasVideo}
            videoPreviewUrl={listing.videoPreviewUrl}
            sizes={WIDE_MEDIA_SIZES}
            priority={priority}
          >
            {listing.boostScore === 1 && <FeaturedBadge />}
            <FavoriteCardButton listingId={listing.id} />
          </CardPhotoCarousel>
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-base font-semibold leading-snug">{listing.title}</p>
          <p className="shrink-0 text-lg font-bold">
            {formatListingPrice(listing.price, listing.currency, listing.priceType, listing.priceUnit)}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {location && <p className="text-xs text-muted-foreground">{location}</p>}
          <SellerRatingInline average={listing.sellerRatingAverage} count={listing.sellerRatingCount} />
        </div>
        <WideCardAttrsDisplay
          categorySlug={listing.categorySlug}
          attributes={listing.attributes as Record<string, unknown> | undefined}
          listingType={listing.type}
        />
        <TruncatedDescription text={listing.description} />
        <ListingStatusBadge status={listing.status} />
      </WideCardShell>
    </Link>
  );
}
