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

const FLOAT_CARD_W = 224; // w-56 = 14rem * 16px
const FLOAT_CARD_OFFSET_Y = 12; // gap between marker and card edge

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Returns all non-null attribute entries for the listing, with their display labels. */
function getAllAttrs(listing: ListingSummary, attributeMap: CardAttributeMap): AttrEntry[] {
  const defs = (listing.categorySlug ? attributeMap[listing.categorySlug] : undefined) ?? [];
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

function FloatingCard({ listing, pos, containerW, onClose }: FloatingCardProps) {
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.thumbnailUrl}
            alt={listing.title}
            className="h-[100px] w-[130px] shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
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

// ─── MapView ──────────────────────────────────────────────────────────────────

interface Props {
  hits: ListingSummary[];
  /** Real total from Meilisearch (may exceed 200 in map mode). Used for cap warning. */
  totalHits: number;
  /** URL for the list-view toggle. Used by the "missing geo" warning link. */
  listUrl: string;
  /**
   * Full attribute map (all attributes, not just card-highlighted ones) built from the
   * categories tree via buildFullAttributeMap(). Used to display labelled attribute rows
   * in the detail panel without an extra API fetch.
   */
  attributeMap: CardAttributeMap;
}

export default function MapView({ hits, totalHits, listUrl, attributeMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Geo coordinates of the selected marker (ref — used by the 'move' listener without
  // needing to be in the closure's capture list, since refs are always current).
  const selectedGeoRef = useRef<{ lng: number; lat: number } | null>(null);

  const [selected, setSelected] = useState<ListingSummary | null>(null);
  // Pixel position of the selected marker relative to the map container.
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);

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

    // Update floating card position on every camera move (pan or zoom).
    // Registered immediately (not inside 'load') so it works during fitBounds animations.
    map.on('move', () => {
      if (selectedGeoRef.current) {
        const px = map.project(selectedGeoRef.current);
        setCardPos({ x: px.x, y: px.y });
      }
    });

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

      // ── Cluster click → zoom in (no panel) ────────────────────────────────
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

      // ── Individual point click → select listing + anchor floating card ─────
      map.on('click', LAYER_POINTS, (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const { id } = f.properties as { id: string };
        const hit = geoHits.find((h) => h.id === id);
        if (!hit) return;

        // Use the listing's precise geo coordinates (not the click point) so the
        // card anchors to the exact centre of the marker circle.
        const geo = { lng: hit._geo.lng, lat: hit._geo.lat };
        selectedGeoRef.current = geo;
        const px = map.project(geo);
        setSelected(hit);
        setCardPos({ x: px.x, y: px.y });
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

  const handleClose = () => {
    setSelected(null);
    selectedGeoRef.current = null;
    setCardPos(null);
  };

  // Container width is used by FloatingCard for horizontal clamping.
  // Safe to read here because FloatingCard only renders after a marker click,
  // by which point the map container is definitely mounted.
  const containerW = containerRef.current?.offsetWidth ?? 600;

  return (
    <div>
      {/* Map canvas + floating card overlay */}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[520px] w-full overflow-hidden rounded-lg"
        />
        {selected && cardPos && (
          <FloatingCard
            listing={selected}
            pos={cardPos}
            containerW={containerW}
            onClose={handleClose}
          />
        )}
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
          attributeMap={attributeMap}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
