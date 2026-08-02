'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROVINCIAS } from '@/lib/provincias';
import { resolveLinkedOptions } from '@/lib/attribute-schema';
import type { AttributeFieldView } from '@/lib/filterable-fields';
import { CategorySelect } from './CategorySelect';
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
  // RP.4 — formatos de precio. Mismas etiquetas que el wizard y el panel de
  // categorías, para que vendedor, admin y comprador lean lo mismo.
  ONE_TIME: 'Pago único',
  PER_MONTH: 'Al mes',
  PER_WEEK: 'A la semana',
  PER_DAY: 'Al día',
  PER_HOUR: 'Por hora',
  PER_UNIT: 'Por unidad',
  PER_SESSION: 'Por sesión',
};

/** Títulos legibles de los grupos de facetas. Sin entrada aquí se muestra el
 *  nombre crudo del campo, que es el comportamiento que ya había. */
const FACET_SECTION_LABELS: Record<string, string> = {
  priceUnit: 'Formato del precio',
};

/** Facetas que NO se muestran cuando solo traen un valor: un filtro con una
 *  única opción no filtra nada, solo hace ruido (§10.4 del diseño). Se aplica
 *  solo a las nuevas para no alterar cómo se ven las facetas ya existentes. */
const HIDE_IF_SINGLE_VALUE = new Set(['priceUnit']);

// Facets already covered by explicit filter controls, or raw slugs with no useful display.
// 'categorySlug' is the Meilisearch field name; skip it because the category is already
// either selected via the dropdown or locked in the URL path on category pages.
const SKIP_FACETS = new Set(['type', 'condition', 'category', 'categorySlug']);

/** A3 — etiquetas de los valores booleanos. Antes se pintaba el valor crudo del
 *  documento de Meilisearch ("true"/"false") como si fuera una opción de negocio. */
const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'Sí' },
  { value: 'false', label: 'No' },
] as const;

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
   * A2 — categoría en la que está el usuario (solo /[categoria]; ausente en /busqueda
   * global). Marca la opción activa del selector. Sustituye a los antiguos
   * `subcategories`/`subcategoryParentSlug`: el selector ya ofrece el árbol entero,
   * así que no hay un control aparte para "bajar" a una hija.
   */
  currentCategorySlug?: string;
  /**
   * A3 — definición efectiva de cada atributo FILTRABLE del ámbito de la página.
   * Es lo que invierte el eje del panel: hasta ahora las secciones de atributo las
   * dictaban las FACETAS que devolvía Meilisearch, así que un atributo filtrable sin
   * ningún anuncio no aparecía nunca. Ahora las dicta la CONFIG y las facetas solo
   * aportan el conteo de cada valor. Ver lib/filterable-fields.ts.
   *
   * Ausente = comportamiento anterior (el panel solo pinta lo que traigan las facetas),
   * para que ningún consumidor que aún no lo pase se quede sin filtros.
   */
  filterableFields?: AttributeFieldView[];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** Chip de valor. `count === 0` lo deja visible pero DESHABILITADO: la sección se pinta
 *  desde la config (F6), y esconder los valores muertos volvería a hacer que la lista la
 *  dictara el resultado — pero dejarlos pulsables llevaría a un callejón de 0 hits. */
function ValueChip({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const vacio = count === 0 && !isActive;
  return (
    <button
      type="button"
      disabled={vacio}
      onClick={onClick}
      className={[
        'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        isActive
          ? 'border-primary bg-primary text-primary-foreground'
          : vacio
            ? 'cursor-not-allowed border-border/60 text-muted-foreground/50'
            : 'border-border hover:border-primary/50 hover:bg-accent',
      ].join(' ')}
    >
      {label}
      <span className={isActive ? 'opacity-70' : 'text-muted-foreground'}>({count})</span>
      {isActive && <X className="h-3 w-3 shrink-0" />}
    </button>
  );
}

/**
 * A3 — un filtro de atributo, pintado SEGÚN SU TIPO.
 *
 * Antes todos se pintaban igual: chips con el valor crudo y el nombre crudo del campo
 * como título ("sqm" en vez de "Metros cuadrados", "true"/"false" en vez de "Sí"/"No").
 * El panel no tenía la definición del atributo, solo pares clave→conteo.
 *
 * `number` se sigue pintando como chips a propósito: convertirlo en un rango mín/máx
 * exige que el backend acepte `_min`/`_max` (hoy los atributos solo se filtran por
 * igualdad), y eso es A4. Aquí ya gana su label y su unidad.
 */
function AttributeFilter({
  field,
  counts,
  value,
  rangeMin,
  rangeMax,
  parentValue,
  onToggle,
  onSet,
  onSetRange,
}: {
  field: AttributeFieldView;
  counts?: Record<string, number>;
  value?: string;
  /** A4 — extremos actuales del rango (`<attr>_min` / `<attr>_max` de la URL). */
  rangeMin?: string;
  rangeMax?: string;
  /** Valor actual del campo del que este depende (`dependsOn`), si lo tiene. */
  parentValue?: string;
  onToggle: (value: string) => void;
  onSet: (value: string | undefined) => void;
  onSetRange: (min: string | undefined, max: string | undefined) => void;
}) {
  const [texto, setTexto] = useState(value ?? '');
  useEffect(() => { setTexto(value ?? ''); }, [value]);

  // Estado local del rango: se aplica en blur/Enter, no en cada tecla — mismo criterio
  // que el filtro de precio, para no lanzar una navegación por dígito tecleado.
  const [min, setMin] = useState(rangeMin ?? '');
  const [max, setMax] = useState(rangeMax ?? '');
  useEffect(() => { setMin(rangeMin ?? ''); setMax(rangeMax ?? ''); }, [rangeMin, rangeMax]);
  const aplicarRango = () => onSetRange(min || undefined, max || undefined);

  const unidad = field.unit ? ` (${field.unit})` : '';
  const titulo = `${field.label}${unidad}`;

  // F5 — un select VINCULADO no se ofrece hasta que su padre tiene valor: sus opciones
  // dependen de él. `resolveLinkedOptions` es la MISMA función que usan el wizard y la
  // validación del backend, no una copia con la regla reescrita.
  if (field.dependsOn) {
    const opciones = resolveLinkedOptions(field, parentValue);
    if (opciones.length === 0) return null;
    return (
      <div data-testid={`facet-${field.name}`}>
        <SectionLabel>{titulo}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {opciones.map((opcion) => (
            <ValueChip
              key={opcion}
              label={opcion}
              count={counts?.[opcion] ?? 0}
              isActive={value === opcion}
              onClick={() => onToggle(opcion)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div data-testid={`facet-${field.name}`}>
        <SectionLabel>{titulo}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {BOOLEAN_OPTIONS.map((o) => (
            <ValueChip
              key={o.value}
              label={o.label}
              count={counts?.[o.value] ?? 0}
              isActive={value === o.value}
              onClick={() => onToggle(o.value)}
            />
          ))}
        </div>
      </div>
    );
  }

  // A4 — un atributo NUMÉRICO se filtra por RANGO, no por valor exacto. Filtrar km o
  // m² por igualdad no sirve de nada: nadie busca "exactamente 120.000 km".
  // Es el molde EXACTO del filtro de precio que ya existía (dos inputs, estado local,
  // aplicar en blur/Enter) para no inventar un tercer patrón de rango en el panel.
  if (field.type === 'number') {
    return (
      <div data-testid={`facet-${field.name}`}>
        <SectionLabel>{titulo}</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="number"
            aria-label={`${field.label} mínimo`}
            placeholder={field.unit ? `Mín (${field.unit})` : 'Mín'}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            onBlur={aplicarRango}
            onKeyDown={(e) => e.key === 'Enter' && aplicarRango()}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="shrink-0 text-muted-foreground">—</span>
          <input
            type="number"
            aria-label={`${field.label} máximo`}
            placeholder={field.unit ? `Máx (${field.unit})` : 'Máx'}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            onBlur={aplicarRango}
            onKeyDown={(e) => e.key === 'Enter' && aplicarRango()}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    );
  }

  if (field.type === 'text') {
    return (
      <div data-testid={`facet-${field.name}`}>
        <SectionLabel>{titulo}</SectionLabel>
        <input
          type="text"
          value={texto}
          aria-label={field.label}
          placeholder={field.label}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => onSet(texto || undefined)}
          onKeyDown={(e) => e.key === 'Enter' && onSet(texto || undefined)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    );
  }

  // `select` y `number`: chips de valores.
  //
  // Un `select` los saca de su CONFIGURACIÓN (`options`), así que se ven todos aunque
  // ninguno tenga anuncios — que es el punto de F6. Un `number` no tiene lista
  // configurada, así que sus valores solo pueden salir de las facetas; su sección
  // aparece igual, vacía si no hay nada que ofrecer todavía.
  const valores =
    field.type === 'select' && field.options?.length
      ? field.options
      : Object.entries(counts ?? {})
          .sort(([, a], [, b]) => b - a)
          .map(([v]) => v);

  return (
    <div data-testid={`facet-${field.name}`}>
      <SectionLabel>{titulo}</SectionLabel>
      {valores.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">Sin valores todavía</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {valores.map((v) => (
            <ValueChip
              key={v}
              label={v}
              count={counts?.[v] ?? 0}
              isActive={value === v}
              onClick={() => onToggle(v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type GeoStatus = 'idle' | 'requesting' | 'denied' | 'unavailable';

export function FilterPanel({
  categories,
  facets,
  currentFilters,
  activeFilterCount,
  allowedListingType,
  currentCategorySlug,
  filterableFields,
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

      {/* Categoría (A2) — un SOLO selector para las dos páginas. Antes había dos
          controles distintos con el mismo papel: el "Categoría" de /busqueda (que solo
          cambiaba un query param y te dejaba allí) y el "Subcategoría" de /[categoria]
          (que navegaba, pero solo hacia abajo). Ahora cualquier destino del árbol —y
          "Todas las categorías"— es alcanzable desde ambas, siempre a la ruta canónica
          y arrastrando solo los filtros que valen en el destino. */}
      {categories.length > 0 && (
        <div>
          <SectionLabel>Categoría</SectionLabel>
          <CategorySelect categories={categories} currentSlug={currentCategorySlug ?? null} />
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

      {/* A3 — FILTROS DE ATRIBUTO, dictados por la CONFIG (no por el resultado).
          Una sección por cada atributo filtrable de la categoría, exista o no en las
          facetas: eso es F6. Los conteos siguen saliendo de `facets`. */}
      {filterableFields?.map((field) => (
        <AttributeFilter
          key={field.name}
          field={field}
          counts={facets?.[field.name]}
          value={searchParams.get(field.name) ?? undefined}
          rangeMin={searchParams.get(`${field.name}_min`) ?? undefined}
          rangeMax={searchParams.get(`${field.name}_max`) ?? undefined}
          parentValue={field.dependsOn ? searchParams.get(field.dependsOn) ?? undefined : undefined}
          onToggle={(value) => toggleFacet(field.name, value)}
          onSet={(value) => update({ [field.name]: value })}
          onSetRange={(min, max) =>
            update({ [`${field.name}_min`]: min, [`${field.name}_max`]: max })
          }
        />
      ))}

      {/* Facetas NATIVAS (priceType, priceUnit, province…): siguen siendo facet-driven.
          No son atributos de categoría —no tienen schema ni `label` que consultar—, así
          que su lista sí la marca lo que devuelva la búsqueda. Se excluyen las que ya
          pinta el bloque de arriba para no duplicar la sección. */}
      {facets &&
        Object.entries(facets)
          .filter(([key]) => !SKIP_FACETS.has(key))
          .filter(([key]) => !filterableFields?.some((f) => f.name === key))
          .map(([facetKey, facetValues]) => {
            const currentValue = searchParams.get(facetKey);
            const entries = Object.entries(facetValues).sort(([, a], [, b]) => b - a);
            if (entries.length === 0) return null;
            if (HIDE_IF_SINGLE_VALUE.has(facetKey) && entries.length < 2) return null;
            return (
              <div key={facetKey} data-testid={`facet-${facetKey}`}>
                <SectionLabel>{FACET_SECTION_LABELS[facetKey] ?? facetKey}</SectionLabel>
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
