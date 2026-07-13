'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROVINCIAS } from '@/lib/provincias';
import type { Category, ListingTypePolicy } from '@/types';

const TYPE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'PRODUCT', label: 'Productos' },
  { value: 'SERVICE', label: 'Servicios' },
] as const;

const CONDITION_OPTIONS = [
  { value: '', label: 'Cualquiera' },
  { value: 'NEW', label: 'Nuevo' },
  { value: 'LIKE_NEW', label: 'Como nuevo' },
  { value: 'GOOD', label: 'Buen estado' },
  { value: 'FAIR', label: 'Aceptable' },
  { value: 'FOR_PARTS', label: 'Para piezas' },
] as const;

const BASE_SORT_OPTIONS = [
  { value: 'publishedAt:desc', label: 'Más recientes' },
  { value: 'price:asc', label: 'Precio: menor a mayor' },
  { value: 'price:desc', label: 'Precio: mayor a menor' },
] as const;

const PROXIMITY_SORT_OPTION = { value: 'distance', label: 'Más cercanos' } as const;

const RADIUS_OPTIONS = [
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
] as const;

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  LIKE_NEW: 'Como nuevo',
  GOOD: 'Buen estado',
  FAIR: 'Aceptable',
  FOR_PARTS: 'Para piezas',
  PRODUCT: 'Productos',
  SERVICE: 'Servicios',
};

// Facets already covered by explicit filter controls, or raw slugs with no useful display.
// 'categorySlug' is the Meilisearch field name; skip it because the category is already
// either selected via the dropdown or locked in the URL path on category pages.
const SKIP_FACETS = new Set(['type', 'condition', 'category', 'categorySlug']);

interface CurrentFilters {
  q?: string;
  category?: string;
  type?: string;
  condition?: string;
  priceType?: string;
  minPrice?: string;
  maxPrice?: string;
  province?: string;
  city?: string;
  sort?: string;
  lat?: string;
  lng?: string;
  radius?: string;
  attributes?: Record<string, string>;
}

interface FilterPanelProps {
  categories: Category[];
  facets?: Record<string, Record<string, number>>;
  currentFilters: CurrentFilters;
  activeFilterCount: number;
  /**
   * Política efectiva de la categoría fija de esta página (solo /[categoria]).
   * Si se pasa y no es 'BOTH', la categoría ya decide el tipo — se oculta el
   * filtro "Tipo" en vez de ofrecer una opción que siempre daría 0 resultados.
   * Ausente en /busqueda (sin categoría fija, o mixta): comportamiento actual.
   */
  allowedListingType?: ListingTypePolicy;
  /**
   * BUG A (auditoría de filtros) — hijas de la categoría FIJA de esta página (solo
   * /[categoria], cuando esa categoría es un padre). /busqueda no lo necesita: su
   * propio selector "Categoría" ya ofrece las hijas vía <optgroup> (categories arriba).
   * Elegir una navega a /{slug de la hija}, arrastrando los filtros ya aplicados (page
   * se descarta, igual que cualquier otro cambio de filtro) — nunca se pierden porque
   * una hija siempre tiene AL MENOS los atributos heredados del padre.
   */
  subcategories?: { slug: string; name: string }[];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

type GeoStatus = 'idle' | 'requesting' | 'denied' | 'unavailable';

export function FilterPanel({
  categories,
  facets,
  currentFilters,
  activeFilterCount,
  allowedListingType,
  subcategories,
}: FilterPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Local state for inputs that apply on blur/Enter to avoid router.push on every keystroke
  const [localMin, setLocalMin] = useState(currentFilters.minPrice ?? '');
  const [localMax, setLocalMax] = useState(currentFilters.maxPrice ?? '');
  const [localCity, setLocalCity] = useState(currentFilters.city ?? '');

  // Geolocation state: tracks the async permission/position request lifecycle.
  // The "active" state is derived from URL props, not this local state.
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');

  const proximityActive =
    !!currentFilters.lat && !!currentFilters.lng && !!currentFilters.radius;

  // BUG B (auditoría de filtros) — "Condición" (estado de conservación) no aplica a
  // servicios, igual que un atributo de card solo-PRODUCT no se muestra en un anuncio
  // SERVICE (mismo patrón, aplicado ahora a un filtro NATIVO en vez de uno de
  // categoría). Se oculta cuando la categoría fija ya es solo-servicio, o cuando el
  // usuario ha filtrado explícitamente por type=SERVICE en una categoría mixta/general.
  const isServiceContext =
    allowedListingType === 'SERVICE_ONLY' || currentFilters.type === 'SERVICE';

  // Sync local inputs when the server re-renders with new URL-derived props
  useEffect(() => {
    setLocalMin(currentFilters.minPrice ?? '');
    setLocalMax(currentFilters.maxPrice ?? '');
    setLocalCity(currentFilters.city ?? '');
    // Reset transient geo error when proximity is deactivated from outside
    if (!proximityActive) setGeoStatus('idle');
  }, [
    currentFilters.minPrice,
    currentFilters.maxPrice,
    currentFilters.city,
    proximityActive,
  ]);

  function update(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // BUG A — navega a la subcategoría elegida (cambia el PATH, no un query param, así
  // que no puede reutilizar update()) arrastrando los filtros ya aplicados. `page` se
  // descarta igual que en update(): narrow a una subcategoría es un cambio de filtro.
  function goToSubcategory(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    const query = params.toString();
    router.push(`/${slug}${query ? `?${query}` : ''}`);
  }

  function toggleFacet(key: string, value: string) {
    const current = searchParams.get(key);
    update({ [key]: current === value ? undefined : value });
  }

  function applyPrice() {
    update({ minPrice: localMin || undefined, maxPrice: localMax || undefined });
  }

  function applyCity() {
    update({ city: localCity || undefined });
  }

  function clearAll() {
    const params = new URLSearchParams();
    if (currentFilters.q) params.set('q', currentFilters.q);
    router.push(`${pathname}?${params.toString()}`);
    setGeoStatus('idle');
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeoStatus('unavailable');
      return;
    }
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Activate proximity: clear sort so the backend applies _geoPoint distance ordering.
        update({
          lat: String(pos.coords.latitude),
          lng: String(pos.coords.longitude),
          radius: '10',
          sort: undefined,
        });
        setGeoStatus('idle');
      },
      (err) => {
        setGeoStatus(
          err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
        );
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function deactivateProximity() {
    update({ lat: undefined, lng: undefined, radius: undefined, sort: undefined });
    setGeoStatus('idle');
  }

  function changeRadius(r: string) {
    update({ radius: r });
  }

  const panelContent = (
    <div className="space-y-5">
      {activeFilterCount > 0 && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Limpiar filtros
        </button>
      )}

      {/* Sort */}
      <div>
        <SectionLabel>Ordenar por</SectionLabel>
        <select
          value={
            currentFilters.sort ??
            (proximityActive ? PROXIMITY_SORT_OPTION.value : 'publishedAt:desc')
          }
          onChange={(e) => {
            // 'distance' is synthetic: clears the sort param so the backend uses _geoPoint
            update({ sort: e.target.value === 'distance' ? undefined : e.target.value });
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {proximityActive && (
            <option value={PROXIMITY_SORT_OPTION.value}>{PROXIMITY_SORT_OPTION.label}</option>
          )}
          {BASE_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Proximity */}
      <div>
        <SectionLabel>Cerca de mí</SectionLabel>

        {proximityActive ? (
          /* Active state — show radius selector and deactivate button */
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-primary">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Mi ubicación activa</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={currentFilters.radius ?? '10'}
                onChange={(e) => changeRadius(e.target.value)}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Radio de búsqueda"
              >
                {RADIUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={deactivateProximity}
                className="flex items-center gap-1 rounded-md border px-2.5 py-2 text-sm text-muted-foreground hover:border-destructive hover:text-destructive"
                aria-label="Desactivar búsqueda por proximidad"
              >
                <X className="h-3.5 w-3.5" />
                Desactivar
              </button>
            </div>
          </div>
        ) : geoStatus === 'requesting' ? (
          /* Requesting state */
          <p className="text-sm text-muted-foreground">Obteniendo tu ubicación…</p>
        ) : geoStatus === 'denied' ? (
          /* Permission denied — give actionable guidance */
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Tu navegador bloqueó el acceso a la ubicación. Para activarlo, permite
              la geolocalización en los ajustes del sitio y vuelve a intentarlo.
            </p>
            <button
              onClick={() => setGeoStatus('idle')}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : geoStatus === 'unavailable' ? (
          /* Position unavailable or API not available */
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No se pudo obtener tu ubicación. Asegúrate de que la geolocalización
              está activada en tu dispositivo o accede desde localhost / HTTPS.
            </p>
            <button
              onClick={() => setGeoStatus('idle')}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : (
          /* Idle state — call to action */
          <button
            onClick={requestLocation}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <MapPin className="h-4 w-4" aria-hidden />
            Usar mi ubicación
          </button>
        )}
      </div>

      {/* Category */}
      {categories.length > 0 && (
        <div>
          <SectionLabel>Categoría</SectionLabel>
          <select
            value={currentFilters.category ?? ''}
            onChange={(e) => update({ category: e.target.value || undefined })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todas las categorías</option>
            {categories.map((cat) =>
              cat.children && cat.children.length > 0 ? (
                <optgroup key={cat.slug} label={cat.name}>
                  <option value={cat.slug}>Todo en {cat.name}</option>
                  {cat.children.map((child) => (
                    <option key={child.slug} value={child.slug}>{child.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={cat.slug} value={cat.slug}>{cat.name}</option>
              )
            )}
          </select>
        </div>
      )}

      {/* Subcategoría (BUG A) — solo /[categoria] cuando la categoría fija tiene hijas.
          /busqueda no la necesita: su propio selector "Categoría" ya las ofrece. */}
      {subcategories && subcategories.length > 0 && (
        <div>
          <SectionLabel>Subcategoría</SectionLabel>
          <select
            value=""
            onChange={(e) => { if (e.target.value) goToSubcategory(e.target.value); }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Acotar a una subcategoría"
          >
            <option value="">Todas</option>
            {subcategories.map((sub) => (
              <option key={sub.slug} value={sub.slug}>{sub.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Type — oculto cuando la categoría fija ya no permite ambos tipos */}
      {(allowedListingType ?? 'BOTH') === 'BOTH' && (
        <div>
          <SectionLabel>Tipo</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {TYPE_OPTIONS.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value={o.value}
                  checked={(currentFilters.type ?? '') === o.value}
                  onChange={() =>
                    update({
                      type: o.value || undefined,
                      // Al pasar a Servicios, "condición" deja de aplicar — se limpia
                      // igual que hace el wizard de publicar al cambiar a SERVICE.
                      ...(o.value === 'SERVICE' ? { condition: undefined } : {}),
                    })
                  }
                  className="accent-primary"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Condition — oculto en contexto solo-servicio (ver isServiceContext arriba) */}
      {!isServiceContext && (
        <div>
          <SectionLabel>Condición</SectionLabel>
          <select
            value={currentFilters.condition ?? ''}
            onChange={(e) => update({ condition: e.target.value || undefined })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CONDITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Price range */}
      <div>
        <SectionLabel>Precio (€)</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="Mín"
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="shrink-0 text-muted-foreground">—</span>
          <input
            type="number"
            min={0}
            placeholder="Máx"
            value={localMax}
            onChange={(e) => setLocalMax(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Province / City */}
      <div>
        <SectionLabel>Ubicación</SectionLabel>
        <div className="flex flex-col gap-2">
          {/* Select cerrado (mismo lib/provincias.ts que la portada) — antes era texto libre
              y una errata o variación de mayúsculas/tildes daba 0 resultados en silencio,
              porque el filtro es un `=` exacto contra el campo `province` del documento. */}
          <select
            value={currentFilters.province ?? ''}
            onChange={(e) => update({ province: e.target.value || undefined })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Provincia"
          >
            <option value="">Toda España</option>
            {PROVINCIAS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Ciudad"
            value={localCity}
            onChange={(e) => setLocalCity(e.target.value)}
            onBlur={applyCity}
            onKeyDown={(e) => e.key === 'Enter' && applyCity()}
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Dynamic facets */}
      {facets &&
        Object.entries(facets)
          .filter(([key]) => !SKIP_FACETS.has(key))
          .map(([facetKey, facetValues]) => {
            const currentValue = searchParams.get(facetKey);
            const entries = Object.entries(facetValues).sort(([, a], [, b]) => b - a);
            if (entries.length === 0) return null;
            return (
              <div key={facetKey}>
                <SectionLabel>{facetKey}</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {entries.map(([value, count]) => {
                    const isActive = currentValue === value;
                    return (
                      <button
                        key={value}
                        onClick={() => toggleFacet(facetKey, value)}
                        className={[
                          'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                          isActive
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:border-primary/50 hover:bg-accent',
                        ].join(' ')}
                      >
                        {CONDITION_LABELS[value] ?? value}
                        <span className={isActive ? 'opacity-70' : 'text-muted-foreground'}>
                          ({count})
                        </span>
                        {isActive && <X className="h-3 w-3 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <div className="lg:hidden">
        <Button
          variant="outline"
          className="mb-4 flex w-full items-center justify-between"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeFilterCount > 0 && (
              <Badge className="flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </Button>
        {open && (
          <div className="rounded-lg border p-4">{panelContent}</div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden rounded-lg border p-4 lg:block">
        <h2 className="mb-4 font-semibold">Filtros</h2>
        {panelContent}
      </div>
    </>
  );
}
