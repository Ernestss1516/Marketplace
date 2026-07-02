'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { ListingSummary } from '@/types';

const SPAIN_CENTER: [number, number] = [-3.7038, 40.4168];
const SPAIN_ZOOM = 5;

const SOURCE = 'listings';
const LAYER_CLUSTERS = 'clusters';
const LAYER_COUNT = 'cluster-count';
const LAYER_POINTS = 'unclustered-point';

// ─── Selected listing panel ────────────────────────────────────────────────────

function SelectedListingPanel({
  listing,
  onClose,
}: {
  listing: ListingSummary;
  onClose: () => void;
}) {
  const priceStr = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: listing.currency ?? 'EUR',
    maximumFractionDigits: 0,
  }).format(listing.price);
  const location = [listing.city, listing.province].filter(Boolean).join(', ');

  return (
    <div
      className="mt-3 flex items-start gap-4 rounded-lg border bg-card p-4 shadow-sm"
      data-testid="map-detail-panel"
    >
      {listing.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={listing.thumbnailUrl}
          alt={listing.title}
          className="h-[72px] w-24 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight">{listing.title}</p>
        <p className="mt-0.5 text-sm font-medium text-primary">{priceStr}</p>
        {location && (
          <p className="mt-0.5 text-xs text-muted-foreground">{location}</p>
        )}
        <Link
          href={`/anuncio/${listing.slug}`}
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          data-testid="map-detail-link"
        >
          Ver anuncio →
        </Link>
      </div>
      <button
        onClick={onClose}
        className="shrink-0 rounded-sm p-1 hover:bg-muted"
        aria-label="Cerrar panel"
        data-testid="map-detail-close"
      >
        <X className="h-4 w-4" />
      </button>
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
}

export default function MapView({ hits, totalHits, listUrl }: Props) {
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

    // Build a GeoJSON FeatureCollection from the hits that have coordinates.
    // Properties are serialized to strings by MapLibre, so the click handler
    // looks up the full hit object from geoHits by id.
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

      // ── Cluster circles (size and colour scale with count) ─────────────────
      map.addLayer({
        id: LAYER_CLUSTERS,
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#60a5fa', 10,   // <10  → blue-400
            '#3b82f6', 50,   // <50  → blue-500
            '#2563eb',       // ≥50  → blue-600
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            20, 10,
            26, 50,
            34,
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
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
        },
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

      // ── Pointer cursor on hover ────────────────────────────────────────────
      for (const layer of [LAYER_CLUSTERS, LAYER_POINTS]) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      // ── Cluster click → zoom in to disaggregate ────────────────────────────
      map.on('click', LAYER_CLUSTERS, async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS] });
        if (!features.length) return;
        const clusterId = features[0].properties!.cluster_id as number;
        const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: e.lngLat, zoom });
        } catch {
          // ignore transient errors (map removed mid-animation, etc.)
        }
      });

      // ── Individual point click → open detail panel ─────────────────────────
      map.on('click', LAYER_POINTS, (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const { id } = f.properties as { id: string };
        const hit = geoHits.find((h) => h.id === id);
        if (hit) setSelected(hit);
      });

      // ── Fit map to all geoHits on mount ───────────────────────────────────
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
    // Component is remounted via key prop when hits change — empty deps is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[520px] w-full overflow-hidden rounded-lg"
      />

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

      {/* Missing-geo warning: some hits have no coordinates */}
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
        <SelectedListingPanel listing={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
