'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MapView from './MapView';
import { GateTerceros } from '@/components/consentimiento/GateTerceros';

// dynamic(ssr:false) must live in a Client Component — Server Components don't allow it.
// This thin wrapper lets busqueda/page.tsx (a Server Component) render the map without
// pulling MapLibre GL JS into the server bundle.
const MapViewDynamic = dynamic(() => import('./MapView'), {
  ssr: false,
  // Mismas clases de alto que el mapa real (MapView.tsx) y que el marcador del gate: los
  // tres tienen que medir igual o habrá salto. Antes esto era `h-[520px]` fijo mientras
  // el mapa crecía en `sm+`, así que ya había CLS en pantallas grandes.
  loading: () => (
    <div className="h-[520px] animate-pulse rounded-lg bg-muted sm:h-[calc(100vh-260px)] sm:min-h-[520px] sm:max-h-[900px]" />
  ),
});

/**
 * COOKIES RÁFAGA 1 — EL GATE DEL MAPA (D3).
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.5.
 *
 * ─── EL GATE VA AQUÍ, POR ENCIMA DEL `dynamic()`, Y NO DENTRO DE `MapView` ──────
 *
 * `dynamic()` sólo dispara la descarga cuando el componente se RENDERIZA. Con el gate
 * por encima, sin consentimiento **el bundle de MapLibre ni siquiera se descarga**, y
 * `MapView` nunca llega a ejecutar el `new maplibregl.Map({style: 'https://api.maptiler…'})`
 * de su línea 71. Dentro de `MapView` sería tarde: para entonces el bundle ya está
 * bajando y el componente ya se ha montado.
 *
 * ─── LAS DOS FORMAS DE LLEGAR AL MAPA, Y POR QUÉ NO SON LO MISMO ────────────────
 *
 *  · **Pulsando «Mapa»** (o abriendo un enlace con `?view=mapa`): el usuario lo pide, y
 *    pedirlo es consentirlo (D3). Carga — con el aviso permanente que `GateTerceros`
 *    añade, para que la exención sea informada y no silenciosa.
 *  · **Aterrizando en una categoría con `defaultView = MAPA`**: el usuario no ha pedido
 *    nada. Marcador, hasta que actúe.
 *
 * `solicitadoPorUsuario` lo calcula quien conoce la URL (`usuarioPidioVista` en
 * `view-mode.ts`), y viaja como `prop`: es una propiedad de la URL, no del visitante, así
 * que **es cacheable** y no rompe el ISR.
 */
export default function MapViewClient({
  solicitadoPorUsuario = false,
  ...props
}: ComponentProps<typeof MapView> & { solicitadoPorUsuario?: boolean }) {
  // The outer div carries data-testid so Playwright can find it as soon as the
  // Client Component mounts — without waiting for the maplibre-gl bundle to load.
  return (
    <div data-testid="map-view">
      <GateTerceros
        proveedor="MapTiler"
        descripcion="El mapa"
        className="h-[520px] sm:h-[calc(100vh-260px)] sm:min-h-[520px] sm:max-h-[900px]"
        solicitadoPorUsuario={solicitadoPorUsuario}
        testId="gate-mapa"
      >
        <MapViewDynamic {...props} />
      </GateTerceros>
    </div>
  );
}
