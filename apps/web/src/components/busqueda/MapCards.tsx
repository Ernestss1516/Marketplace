'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { ListingSummary } from '@/types';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';
import { VideoIndicator } from '@/components/anuncios/VideoIndicator';
import { FeaturedBadge } from '@/components/anuncios/FeaturedBadge';
import { filterDefsByListingType } from '@/lib/card-attributes';

/**
 * LAS DOS TARJETAS DEL MAPA — la flotante sobre el marcador y el panel de debajo.
 *
 * POR QUÉ VIVEN AQUÍ Y NO DENTRO DE `MapView`. Son presentación pura: reciben un anuncio y
 * lo pintan. Estaban dentro del fichero del mapa, que importa `maplibre-gl` y monta un
 * canvas WebGL — es decir, **no se podían probar sin levantar un mapa entero**, y por eso
 * fueron las dos únicas superficies de tarjeta que se quedaron sin indicador de vídeo
 * cuando se añadió al resto: nada podía delatar la ausencia.
 *
 * Sacarlas es lo que permite que la barrera exista. `MapView` sigue siendo quien decide
 * CUÁNDO se muestran y con qué posición; estas dos sólo saben pintar.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (hueco V-3).
 */

const FLOAT_CARD_W = 224; // w-56 = 14rem * 16px
const FLOAT_CARD_OFFSET_Y = 12; // gap between marker and card edge


function formatPrice(price: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

interface AttrEntry {
  label: string;
  value: string;
}

/** Returns all non-null attribute entries for the listing, with their display labels.
 * ATRIBUTOS EN CARD — respetar producto/servicio: filtrado por el `type` de ESTE
 * anuncio antes de formatear (mismo criterio que CardAttrsDisplay/WideCardAttrsDisplay). */
function getAllAttrs(listing: ListingSummary, attributeMap: CardAttributeMap): AttrEntry[] {
  const allDefs = (listing.categorySlug ? attributeMap[listing.categorySlug] : undefined) ?? [];
  const defs = filterDefsByListingType(allDefs, listing.type);
  return defs
    .map((def) => {
      const raw = listing.attributes?.[def.key];
      if (raw == null || String(raw) === '') return null;
      const str = String(raw);
      return { label: def.label, value: def.unit ? `${str} ${def.unit}` : str };
    })
    .filter((e): e is AttrEntry => e !== null);
}

// ─── Floating compact card (positioned above/below the selected marker) ───────

interface FloatingCardProps {
  listing: ListingSummary;
  pos: { x: number; y: number };
  containerW: number;
  onClose: () => void;
}

export function FloatingCard({ listing, pos, containerW, onClose }: FloatingCardProps) {
  const priceStr = formatPrice(listing.price, listing.currency);

  // Keep card within horizontal bounds of the map container
  const clampedX = Math.min(
    Math.max(pos.x, FLOAT_CARD_W / 2 + 4),
    containerW - FLOAT_CARD_W / 2 - 4,
  );
  // Flip below the marker when too close to the top edge
  const showBelow = pos.y < 110;
  const translateY = showBelow
    ? `${FLOAT_CARD_OFFSET_Y}px`
    : `calc(-100% - ${FLOAT_CARD_OFFSET_Y}px)`;

  return (
    <div
      style={{
        position: 'absolute',
        left: clampedX,
        top: pos.y,
        transform: `translate(-50%, ${translateY})`,
        zIndex: 10,
        width: FLOAT_CARD_W,
        pointerEvents: 'auto',
      }}
      className="overflow-hidden rounded-xl border bg-white/95 shadow-lg backdrop-blur-sm"
    >
      <Link
        href={`/anuncio/${listing.slug}`}
        className="flex items-center gap-3 p-2.5 hover:bg-neutral-surface"
        data-testid="map-float-link"
      >
        {listing.thumbnailUrl && (
          // El `relative` es NUEVO y lo pide el indicador de vídeo: sin él, la píldora se
          // posicionaría contra el enlace entero en vez de contra la miniatura.
          <span className="relative h-14 w-14 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={listing.thumbnailUrl}
              alt=""
              className="h-14 w-14 rounded-lg object-cover"
              loading="lazy"
            />
            {/* COMPACTO a propósito: 56 px no dan para la píldora con la palabra «Vídeo»
                —se saldría de la miniatura—. Mismo componente y mismo testid; lo que
                cambia es cuánto ocupa, no qué dice. */}
            {listing.hasVideo && <VideoIndicator compact className="bottom-0.5 right-0.5" />}
            {/* Y la etiqueta de destacado, por el MISMO motivo y con el mismo criterio: en
                56 px sólo cabe la estrella. Sin esto, un anuncio por el que alguien ha
                pagado era indistinguible de cualquier otro en la vista de mapa. */}
            {listing.boostScore === 1 && <FeaturedBadge compact className="left-0.5 top-0.5" />}
          </span>
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
            {listing.title}
          </p>
          <p className="mt-0.5 text-xs font-medium text-primary">{priceStr}</p>
        </div>
      </Link>
      <button
        onClick={onClose}
        className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Cerrar tarjeta"
        data-testid="map-float-close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Detail panel (below the map) ─────────────────────────────────────────────

export function SelectedListingPanel({
  listing,
  attributeMap,
  onClose,
}: {
  listing: ListingSummary;
  attributeMap: CardAttributeMap;
  onClose: () => void;
}) {
  const priceStr = formatPrice(listing.price, listing.currency);
  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const allAttrs = getAllAttrs(listing, attributeMap);

  return (
    <div
      className="mt-3 rounded-xl border bg-card shadow-sm"
      data-testid="map-detail-panel"
    >
      <div className="flex items-start gap-4 p-4">
        {/* Thumbnail */}
        {listing.thumbnailUrl && (
          <span className="relative h-[100px] w-[130px] shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={listing.thumbnailUrl}
              alt={listing.title}
              className="h-[100px] w-[130px] rounded-lg object-cover"
              loading="lazy"
            />
            {/* Aquí SÍ cabe la píldora completa: 130×100 px. Vale para las dos. */}
            {listing.hasVideo && <VideoIndicator className="bottom-1 right-1" />}
            {listing.boostScore === 1 && <FeaturedBadge className="left-1 top-1" />}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{listing.title}</p>
          <p className="mt-0.5 text-base font-bold text-primary">{priceStr}</p>
          {location && (
            <p className="mt-0.5 text-xs text-muted-foreground">{location}</p>
          )}
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Cerrar panel"
          data-testid="map-detail-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* All category attributes — 2-column grid so they're readable */}
      {allAttrs.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t px-4 py-2.5 text-xs">
          {allAttrs.map((attr) => (
            <div key={attr.label} className="flex gap-1.5 overflow-hidden">
              <dt className="shrink-0 text-muted-foreground">{attr.label}:</dt>
              <dd className="truncate font-medium">{attr.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Truncated description (only present in Meilisearch hits) */}
      {listing.description && (
        <p className="line-clamp-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
          {listing.description}
        </p>
      )}

      {/* Seller + CTA */}
      <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
        {listing.sellerName && (
          <div className="flex min-w-0 items-center gap-2">
            {listing.sellerAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.sellerAvatarUrl}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
            )}
            <span className="truncate text-xs text-muted-foreground">{listing.sellerName}</span>
          </div>
        )}

        <Link
          href={`/anuncio/${listing.slug}`}
          className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          data-testid="map-detail-link"
        >
          Ver anuncio completo →
        </Link>
      </div>
    </div>
  );
}
