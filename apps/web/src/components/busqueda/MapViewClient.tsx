'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MapView from './MapView';

// dynamic(ssr:false) must live in a Client Component — Server Components don't allow it.
// This thin wrapper lets busqueda/page.tsx (a Server Component) render the map without
// pulling MapLibre GL JS into the server bundle.
const MapViewDynamic = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse rounded-lg bg-muted" />,
});

export default function MapViewClient(props: ComponentProps<typeof MapView>) {
  return <MapViewDynamic {...props} />;
}
