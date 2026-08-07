'use client';

import { useRef, useState } from 'react';

/**
 * PESTAÑAS SSR — island de VISIBILIDAD, no de contenido.
 *
 * Los paneles llegan como `ReactNode` **ya renderizados en el Server Component**
 * que monta este componente. Aquí no se genera ni un enlace: lo único que hace
 * el cliente es mover un atributo `hidden`.
 *
 * POR QUÉ NO RADIX (docs/diseno-portada.md §4.7): `@radix-ui/react-tabs` no está
 * instalado, y su comportamiento por defecto es **DESMONTAR el panel inactivo**.
 * Eso sacaría del HTML los enlaces de las pestañas no activas — que son
 * literalmente el motivo de existir de este bloque: cientos de enlaces internos
 * a búsquedas que un crawler tiene que ver. Instalar una dependencia para luego
 * desactivar su comportamiento principal (`forceMount` + ocultar a mano) no
 * compensa; esto son cuarenta líneas.
 *
 * TRADE-OFF ASUMIDO Y ESCRITO: los paneles inactivos se sirven CON `hidden`
 * desde el servidor, no visibles-y-luego-ocultos. El contenido está en el HTML y
 * sus enlaces se rastrean; a cambio, Google pondera algo menos lo que solo se ve
 * tras interactuar. La alternativa —los tres paneles a la vez— destruye la
 * interfaz, que es el motivo de que haya pestañas. Y servir `hidden` desde el
 * servidor evita el parpadeo de pintarlos todos y ocultarlos al hidratar, mismo
 * criterio de "el primer render coincide con el SSR" que ya asume `BannerList`.
 */
export function SearchTabs({
  tabs,
}: {
  tabs: { id: string; label: string; panel: React.ReactNode }[];
}) {
  const [activo, setActivo] = useState(0);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  /** Roving tabindex: solo la pestaña activa es tabulable; entre ellas se navega
   *  con flechas, que es lo que un `tablist` estándar debe hacer. */
  function onKeyDown(e: React.KeyboardEvent) {
    const ultimo = tabs.length - 1;
    let destino: number | null = null;
    if (e.key === 'ArrowRight') destino = activo === ultimo ? 0 : activo + 1;
    else if (e.key === 'ArrowLeft') destino = activo === 0 ? ultimo : activo - 1;
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = ultimo;
    if (destino === null) return;

    e.preventDefault();
    setActivo(destino);
    botones.current[destino]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Búsquedas frecuentes"
        className="mb-4 flex flex-wrap gap-1 border-b"
        onKeyDown={onKeyDown}
        data-testid="search-tabs-list"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              botones.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={i === activo}
            aria-controls={`panel-${tab.id}`}
            tabIndex={i === activo ? 0 : -1}
            onClick={() => setActivo(i)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm transition-colors ${
              i === activo
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`search-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          // `hidden`, NO desmontado: el panel y todos sus enlaces siguen en el
          // DOM y en el HTML servido.
          hidden={i !== activo}
          data-testid={`search-panel-${tab.id}`}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
