'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Category } from '@/types';

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

const SORT_OPTIONS = [
  { value: 'publishedAt:desc', label: 'Más recientes' },
  { value: 'price:asc', label: 'Precio: menor a mayor' },
  { value: 'price:desc', label: 'Precio: mayor a menor' },
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

// Facets already covered by explicit filter controls — skip rendering them separately
const SKIP_FACETS = new Set(['type', 'condition', 'category']);

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
  attributes?: Record<string, string>;
}

interface FilterPanelProps {
  categories: Category[];
  facets?: Record<string, Record<string, number>>;
  currentFilters: CurrentFilters;
  activeFilterCount: number;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function FilterPanel({
  categories,
  facets,
  currentFilters,
  activeFilterCount,
}: FilterPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Local state for inputs that apply on blur/Enter to avoid router.push on every keystroke
  const [localMin, setLocalMin] = useState(currentFilters.minPrice ?? '');
  const [localMax, setLocalMax] = useState(currentFilters.maxPrice ?? '');
  const [localProvince, setLocalProvince] = useState(currentFilters.province ?? '');
  const [localCity, setLocalCity] = useState(currentFilters.city ?? '');

  // Sync local inputs when the server re-renders with new URL-derived props
  useEffect(() => {
    setLocalMin(currentFilters.minPrice ?? '');
    setLocalMax(currentFilters.maxPrice ?? '');
    setLocalProvince(currentFilters.province ?? '');
    setLocalCity(currentFilters.city ?? '');
  }, [currentFilters.minPrice, currentFilters.maxPrice, currentFilters.province, currentFilters.city]);

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

  function applyLocation() {
    update({ province: localProvince || undefined, city: localCity || undefined });
  }

  function clearAll() {
    const params = new URLSearchParams();
    if (currentFilters.q) params.set('q', currentFilters.q);
    router.push(`${pathname}?${params.toString()}`);
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
          value={currentFilters.sort ?? 'publishedAt:desc'}
          onChange={(e) => update({ sort: e.target.value })}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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

      {/* Type */}
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
                onChange={() => update({ type: o.value || undefined })}
                className="accent-primary"
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>

      {/* Condition */}
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
          <input
            type="text"
            placeholder="Provincia"
            value={localProvince}
            onChange={(e) => setLocalProvince(e.target.value)}
            onBlur={applyLocation}
            onKeyDown={(e) => e.key === 'Enter' && applyLocation()}
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="text"
            placeholder="Ciudad"
            value={localCity}
            onChange={(e) => setLocalCity(e.target.value)}
            onBlur={applyLocation}
            onKeyDown={(e) => e.key === 'Enter' && applyLocation()}
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
