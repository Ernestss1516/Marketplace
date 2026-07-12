'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ListingsBlock, ListingsBlockLimit, ListingsBlockSort } from '@/types/blocks';
import { LISTINGS_BLOCK_LIMITS } from '@/types/blocks';
import { getCategories } from '@/lib/api/categorias';
import { search } from '@/lib/api/busqueda';
import type { Category } from '@/types';
import { inputCls, labelCls, errorCls } from './shared';

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

const SORT_OPTIONS: { value: ListingsBlockSort; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'featured', label: 'Destacados primero' },
];

// Primer bloque DINÁMICO: no guarda contenido, guarda una consulta
// (categorySlug + limit + sort) — ver ListingsBlockRenderer. El aviso de
// "categoría sin anuncios" reutiliza el mismo search() público (hitsPerPage:1
// solo para leer totalHits, sin pintar resultados) — ninguna fuente nueva,
// solo una llamada más barata a la misma.
export function ListingsBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: ListingsBlock;
  onChange: (patch: Partial<ListingsBlock>) => void;
  disabled?: boolean;
}) {
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [checking, setChecking] = useState(false);
  const [emptyCategory, setEmptyCategory] = useState(false);

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(flattenCategories(cats)))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!block.categorySlug) {
      setEmptyCategory(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    search({ category: block.categorySlug, hitsPerPage: 1 })
      .then((res) => {
        if (!cancelled) setEmptyCategory(res.totalHits === 0);
      })
      .catch(() => {
        if (!cancelled) setEmptyCategory(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [block.categorySlug]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título de la sección (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Lo más reciente en Móviles"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Categoría *</label>
        <select
          value={block.categorySlug}
          onChange={(e) => onChange({ categorySlug: e.target.value })}
          className={inputCls}
          disabled={disabled}
          data-testid="listings-category-select"
        >
          <option value="">Elige una categoría</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
        {!checking && emptyCategory && (
          <p className={errorCls}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            Esta categoría no tiene anuncios activos ahora mismo — el bloque no se mostrará en la página
            hasta que haya alguno.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Nº de anuncios</label>
          <select
            value={block.limit}
            onChange={(e) => onChange({ limit: Number(e.target.value) as ListingsBlockLimit })}
            className={inputCls}
            disabled={disabled}
          >
            {LISTINGS_BLOCK_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Orden</label>
          <select
            value={block.sort ?? 'recent'}
            onChange={(e) => onChange({ sort: e.target.value as ListingsBlockSort })}
            className={inputCls}
            disabled={disabled}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={block.showAllLink ?? false}
          onChange={(e) => onChange({ showAllLink: e.target.checked })}
          disabled={disabled}
        />
        Mostrar enlace &quot;Ver todos&quot;
      </label>
    </div>
  );
}
