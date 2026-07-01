'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ListingSummary } from '@/types';

// Default center: Spain. Used when no hits have coordinates.
const SPAIN_CENTER: [number, number] = [-3.7038, 40.4168];
const SPAIN_ZOOM = 5;

interface Props {
  hits: ListingSummary[];
}

export default function MapView({ hits }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '';

    // Only hits with valid coordinates can be pinned.
    // IMPORTANT: MapLibre uses [longitude, latitude] (GeoJSON order),
    // the opposite of the intuitive [lat, lng]. Getting this wrong puts
    // all markers in the wrong hemisphere.
    const geoHits = hits.filter(
      (h): h is ListingSummary & { _geo: { lat: number; lng: number } } =>
        h._geo != null && isFinite(h._geo.lat) && isFinite(h._geo.lng),
    );

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
      center: SPAIN_CENTER,
      zoom: SPAIN_ZOOM,
    });

    mapRef.current = map;

    map.on('load', () => {
      for (const hit of geoHits) {
        new maplibregl.Marker()
          .setLngLat([hit._geo.lng, hit._geo.lat])
          .addTo(map);
      }

      if (geoHits.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const hit of geoHits) {
          bounds.extend([hit._geo.lng, hit._geo.lat]);
        }
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Empty deps: this component is remounted via key prop (in parent) when hits change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="map-view"
      className="h-[520px] w-full overflow-hidden rounded-lg"
    />
  );
}
