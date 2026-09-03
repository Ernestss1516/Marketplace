'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import type { ListingSummary } from '@/types';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';
// UI del mapa — las dos tarjetas viven aparte para poder probarlas sin levantar un mapa.
import { FloatingCard, SelectedListingPanel } from './MapCards';

const SPAIN_CENTER: [number, number] = [-3.7038, 40.4168];
const SPAIN_ZOOM = 5;

const SOURCE = 'listings';
const LAYER_CLUSTERS = 'clusters';
const LAYER_COUNT = 'cluster-count';
const LAYER_POINTS = 'unclustered-point';

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
          // RÁFAGA 2 — mapa más grande: alto relativo al viewport (antes fijo en
          // 520px) para aprovechar la pantalla, con un suelo igual al tamaño
          // anterior (nunca más pequeño que antes) y un techo para pantallas muy
          // altas. El clustering (H6.5b) ya soporta muchos marcadores; esto es
          // solo layout, no cambia cuántos se pintan.
          className="h-[520px] w-full overflow-hidden rounded-lg sm:h-[calc(100vh-260px)] sm:min-h-[520px] sm:max-h-[900px]"
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
          className="mt-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground"
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
