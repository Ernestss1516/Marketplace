'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { ListingSummary } from '@/types';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';

const SPAIN_CENTER: [number, number] = [-3.7038, 40.4168];
const SPAIN_ZOOM = 5;

const SOURCE = 'listings';
const LAYER_CLUSTERS = 'clusters';
const LAYER_COUNT = 'cluster-count';
const LAYER_POINTS = 'unclustered-point';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

/** Returns "Label: valor" / "valor unit" pairs for card attributes. */
function getCardAttrs(
  listing: ListingSummary,
  cardAttributeMap: CardAttributeMap,
): { label: string; value: string; hasUnit: boolean }[] {
  const defs = (listing.categorySlug ? cardAttributeMap[listing.categorySlug] : undefined) ?? [];
  return defs
    .map((def) => {
      const raw = listing.attributes?.[def.key];
      if (raw == null || String(raw) === '') return null;
      const str = String(raw);
      return { label: def.label, value: def.unit ? `${str} ${def.unit}` : str, hasUnit: !!def.unit };
    })
    .filter((e): e is { label: string; value: string; hasUnit: boolean } => e !== null);
}

// ─── Floating compact card (absolute, over the map) ───────────────────────────

function FloatingCard({
  listing,
  onClose,
}: {
  listing: ListingSummary;
  onClose: () => void;
}) {
  const priceStr = formatPrice(listing.price, listing.currency);

  return (
    <div className="absolute bottom-4 right-4 z-10 w-56 overflow-hidden rounded-xl border bg-white/95 shadow-lg backdrop-blur-sm">
      <Link
        href={`/anuncio/${listing.slug}`}
        className="flex items-center gap-3 p-2.5 hover:bg-gray-50"
        data-testid="map-float-link"
      >
        {listing.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.thumbnailUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
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

function SelectedListingPanel({
  listing,
  cardAttributeMap,
  onClose,
}: {
  listing: ListingSummary;
  cardAttributeMap: CardAttributeMap;
  onClose: () => void;
}) {
  const priceStr = formatPrice(listing.price, listing.currency);
  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const cardAttrs = getCardAttrs(listing, cardAttributeMap);
  const attrsLine = cardAttrs
    .map((e) => (e.hasUnit ? e.value : `${e.label}: ${e.value}`))
    .join(' · ');

  return (
    <div
      className="mt-3 rounded-xl border bg-card shadow-sm"
      data-testid="map-detail-panel"
    >
      <div className="flex items-start gap-4 p-4">
        {/* Thumbnail — wider than before */}
        {listing.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.thumbnailUrl}
            alt={listing.title}
            className="h-[100px] w-[130px] shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
        )}

        <div className="min-w-0 flex-1">
          {/* Title + price */}
          <p className="font-semibold leading-tight">{listing.title}</p>
          <p className="mt-0.5 text-base font-bold text-primary">{priceStr}</p>

          {/* Location */}
          {location && (
            <p className="mt-0.5 text-xs text-muted-foreground">{location}</p>
          )}

          {/* Card attributes (Marca: Toyota · Año: 2022 …) */}
          {attrsLine && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{attrsLine}</p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Cerrar panel"
          data-testid="map-detail-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Description (truncated, only if present in the Meilisearch hit) */}
      {listing.description && (
        <p className="line-clamp-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
          {listing.description}
        </p>
      )}

      {/* Seller + CTA */}
      <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
        {/* Public seller info */}
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

        {/* Primary CTA */}
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

// ─── MapView ──────────────────────────────────────────────────────────────────

interface Props {
  hits: ListingSummary[];
  /** Real total from Meilisearch (may exceed 200 in map mode). Used for cap warning. */
  totalHits: number;
  /** URL for the list-view toggle. Used by the "missing geo" warning link. */
  listUrl: string;
  /** Category attribute map for rendering card attributes in the detail panel. */
  cardAttributeMap: CardAttributeMap;
}

export default function MapView({ hits, totalHits, listUrl, cardAttributeMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<ListingSummary | null>(null);

  const geoHits = hits.filter(
    (h): h is ListingSummary & { _geo: { lat: number; lng: number } } =>
      h._geo != null && isFinite(h._geo.lat) && isFinite(h._geo.lng),
  );
  const missingGeo = hits.length - geoHits.length;
  const showCapWarning = totalHits > hits.length;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '';

    const geojsonData = {
      type: 'FeatureCollection',
      features: geoHits.map((h) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h._geo.lng, h._geo.lat] },
        properties: { id: h.id },
      })),
    };

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
      center: SPAIN_CENTER,
      zoom: SPAIN_ZOOM,
    });

    mapRef.current = map;

    map.on('load', () => {
      // ── GeoJSON source with native MapLibre clustering ─────────────────────
      map.addSource(SOURCE, {
        type: 'geojson',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: geojsonData as any,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // ── Cluster circles ────────────────────────────────────────────────────
      map.addLayer({
        id: LAYER_CLUSTERS,
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#60a5fa', 10, '#3b82f6', 50, '#2563eb',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            20, 10, 26, 50, 34,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Cluster count labels ───────────────────────────────────────────────
      map.addLayer({
        id: LAYER_COUNT,
        type: 'symbol',
        source: SOURCE,
        filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
        paint: { 'text-color': '#ffffff' },
      });

      // ── Individual marker dots ─────────────────────────────────────────────
      map.addLayer({
        id: LAYER_POINTS,
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#2563eb',
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Cursor styles ──────────────────────────────────────────────────────
      for (const layer of [LAYER_CLUSTERS, LAYER_POINTS]) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      // ── Cluster click → zoom in ────────────────────────────────────────────
      map.on('click', LAYER_CLUSTERS, async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS] });
        if (!features.length) return;
        const clusterId = features[0].properties!.cluster_id as number;
        const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: e.lngLat, zoom });
        } catch {
          // ignore transient errors
        }
      });

      // ── Individual point click → select listing ────────────────────────────
      map.on('click', LAYER_POINTS, (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const { id } = f.properties as { id: string };
        const hit = geoHits.find((h) => h.id === id);
        if (hit) setSelected(hit);
      });

      // ── Fit to all geoHits on mount ────────────────────────────────────────
      if (geoHits.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const h of geoHits) bounds.extend([h._geo.lng, h._geo.lat]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Component remounts via key prop when hits change — empty deps is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => setSelected(null);

  return (
    <div>
      {/* Map canvas + floating card overlay */}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[520px] w-full overflow-hidden rounded-lg"
        />
        {selected && <FloatingCard listing={selected} onClose={handleClose} />}
      </div>

      {/* Cap warning: map shows at most 200 hits but there are more */}
      {showCapWarning && (
        <div
          role="status"
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid="map-cap-warning"
        >
          Mostrando {hits.length} de {totalHits.toLocaleString('es-ES')} anuncios en el mapa.{' '}
          Afina los filtros para ver todos.
        </div>
      )}

      {/* Missing-geo warning */}
      {missingGeo > 0 && (
        <div
          role="status"
          className="mt-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
          data-testid="map-missing-geo"
        >
          {missingGeo}{' '}
          {missingGeo === 1 ? 'anuncio no tiene' : 'anuncios no tienen'} ubicación y no{' '}
          {missingGeo === 1 ? 'aparece' : 'aparecen'} en el mapa.{' '}
          <Link
            href={listUrl}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Ver lista
          </Link>
        </div>
      )}

      {/* Selected listing detail panel */}
      {selected && (
        <SelectedListingPanel
          listing={selected}
          cardAttributeMap={cardAttributeMap}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
