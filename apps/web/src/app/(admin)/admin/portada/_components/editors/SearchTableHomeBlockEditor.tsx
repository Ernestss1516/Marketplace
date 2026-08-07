'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROVINCIAS } from '@/lib/provincias';
import { getCategories } from '@/lib/api/categorias';
import type { Category } from '@/types';
import {
  SEARCH_TABLE_COLUMNS,
  type HomeSearchTableBlock,
  type SearchTableColumns,
  type SearchTableTab,
} from '@/types/home-blocks';
import { inputCls, labelCls, hintCls } from './shared';

type TabKind = SearchTableTab['kind'];

const TAB_META: Record<TabKind, { label: string; ayuda: string }> = {
  locations: {
    label: 'Por provincia',
    ayuda: 'Un enlace por cada una de las 52 provincias. No hay nada que configurar.',
  },
  categories: {
    label: 'Por categoría',
    ayuda: 'Un enlace por categoría, tomadas del árbol de categorías.',
  },
  combos: {
    label: 'Combinaciones',
    ayuda: 'Los pares categoría + provincia que elijas, p. ej. "Coches en Madrid".',
  },
};

const ORDEN: TabKind[] = ['locations', 'categories', 'combos'];

function flattenCategories(categories: Category[]): { slug: string; label: string }[] {
  const out: { slug: string; label: string }[] = [];
  for (const root of categories) {
    out.push({ slug: root.slug, label: root.name });
    for (const child of root.children ?? []) {
      out.push({ slug: child.slug, label: `${root.name} > ${child.name}` });
    }
  }
  return out;
}

function tabPorDefecto(kind: TabKind): SearchTableTab {
  if (kind === 'locations') return { kind, label: TAB_META.locations.label };
  if (kind === 'categories') return { kind, label: TAB_META.categories.label, includeChildren: true };
  return { kind, label: TAB_META.combos.label, items: [{ categorySlug: '', province: PROVINCIAS[0] }] };
}

export function SearchTableHomeBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HomeSearchTableBlock;
  onChange: (patch: Partial<HomeSearchTableBlock>) => void;
  disabled?: boolean;
}) {
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(flattenCategories(cats)))
      .catch(() => setCategories([]));
  }, []);

  function toggleTab(kind: TabKind, activar: boolean) {
    if (!activar) {
      // El backend exige al menos una pestaña: si es la última, no se quita.
      if (block.tabs.length <= 1) return;
      return onChange({ tabs: block.tabs.filter((t) => t.kind !== kind) });
    }
    // Se añade respetando el orden canónico, no el de los clics: así la tabla
    // sale siempre igual y el admin no tiene que pensar en el orden.
    const nuevas = [...block.tabs, tabPorDefecto(kind)];
    nuevas.sort((a, b) => ORDEN.indexOf(a.kind) - ORDEN.indexOf(b.kind));
    onChange({ tabs: nuevas });
  }

  function updateTab(kind: TabKind, patch: Partial<SearchTableTab>) {
    onChange({
      tabs: block.tabs.map((t) => (t.kind === kind ? ({ ...t, ...patch } as SearchTableTab) : t)),
    });
  }

  const combos = block.tabs.find((t) => t.kind === 'combos');
  const categoriesTab = block.tabs.find((t) => t.kind === 'categories');

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Título de la sección (opcional)</label>
          <input
            type="text"
            value={block.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value || undefined })}
            className={inputCls}
            disabled={disabled}
            placeholder="p.ej. Búsquedas frecuentes"
            data-testid="table-title"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Columnas de enlaces</label>
          <select
            value={block.columns ?? 3}
            onChange={(e) => onChange({ columns: Number(e.target.value) as SearchTableColumns })}
            className={inputCls}
            disabled={disabled}
            data-testid="table-columns"
          >
            {SEARCH_TABLE_COLUMNS.map((n) => (
              <option key={n} value={n}>
                {n} columnas
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className={labelCls}>Pestañas</label>
        <p className={hintCls}>
          Los enlaces de TODAS las pestañas activas se envían en la página aunque solo se vea una:
          es lo que hace que los buscadores los encuentren.
        </p>

        {ORDEN.map((kind) => {
          const activa = block.tabs.some((t) => t.kind === kind);
          return (
            <div key={kind} className="rounded-md border bg-muted/10 p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activa}
                  onChange={(e) => toggleTab(kind, e.target.checked)}
                  // No se puede quitar la última: el bloque necesita al menos una.
                  disabled={disabled || (activa && block.tabs.length <= 1)}
                  className="mt-1"
                  data-testid={`table-tab-${kind}`}
                />
                <span>
                  <span className="block font-medium">{TAB_META[kind].label}</span>
                  <span className="block text-xs text-muted-foreground">{TAB_META[kind].ayuda}</span>
                </span>
              </label>

              {activa && (
                <div className="mt-2 space-y-2 pl-6">
                  <div className="flex flex-col gap-1">
                    <label className={labelCls}>Texto de la pestaña</label>
                    <input
                      type="text"
                      value={block.tabs.find((t) => t.kind === kind)?.label ?? ''}
                      onChange={(e) => updateTab(kind, { label: e.target.value })}
                      className={inputCls}
                      disabled={disabled}
                      data-testid={`table-tab-label-${kind}`}
                    />
                  </div>

                  {kind === 'categories' && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={
                          (categoriesTab as { includeChildren?: boolean } | undefined)
                            ?.includeChildren ?? false
                        }
                        onChange={(e) => updateTab('categories', { includeChildren: e.target.checked } as Partial<SearchTableTab>)}
                        disabled={disabled}
                        data-testid="table-include-children"
                      />
                      Incluir también las subcategorías
                    </label>
                  )}

                  {kind === 'combos' && combos?.kind === 'combos' && (
                    <div className="space-y-2" data-testid="table-combos">
                      {combos.items.map((item, i) => (
                        <div key={i} className="flex items-end gap-2">
                          <div className="flex flex-1 flex-col gap-1">
                            <label className={labelCls}>Categoría</label>
                            <select
                              value={item.categorySlug}
                              onChange={(e) =>
                                updateTab('combos', {
                                  items: combos.items.map((it, j) =>
                                    j === i ? { ...it, categorySlug: e.target.value } : it,
                                  ),
                                } as Partial<SearchTableTab>)
                              }
                              className={inputCls}
                              disabled={disabled}
                              data-testid={`table-combo-category-${i}`}
                            >
                              <option value="">Elige una categoría</option>
                              {categories.map((c) => (
                                <option key={c.slug} value={c.slug}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex flex-1 flex-col gap-1">
                            <label className={labelCls}>Provincia</label>
                            {/* Un <select> con las 52, no un campo libre: el
                                backend NO valida el nombre de provincia (la
                                lista vive en el frontend), así que la garantía
                                de que no haya un typo es esta. */}
                            <select
                              value={item.province}
                              onChange={(e) =>
                                updateTab('combos', {
                                  items: combos.items.map((it, j) =>
                                    j === i ? { ...it, province: e.target.value } : it,
                                  ),
                                } as Partial<SearchTableTab>)
                              }
                              className={inputCls}
                              disabled={disabled}
                              data-testid={`table-combo-province-${i}`}
                            >
                              {PROVINCIAS.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateTab('combos', {
                                items: combos.items.filter((_, j) => j !== i),
                              } as Partial<SearchTableTab>)
                            }
                            disabled={disabled || combos.items.length <= 1}
                            className="mb-2 h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                            title={combos.items.length <= 1 ? 'Debe quedar al menos una' : 'Quitar'}
                            aria-label={`Quitar combinación ${i + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateTab('combos', {
                            items: [...combos.items, { categorySlug: '', province: PROVINCIAS[0] }],
                          } as Partial<SearchTableTab>)
                        }
                        disabled={disabled || combos.items.length >= 60}
                        data-testid="table-add-combo"
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Añadir combinación
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
