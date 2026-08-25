'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { Category } from '@/types';
import {
  LISTINGS_LIMITS,
  type HomeListingsBlock,
  type ListingsLimit,
  type ListingsSort,
} from '@/types/home-blocks';
import { getCategories } from '@/lib/api/categorias';
import { search } from '@/lib/api/busqueda';
import { inputCls, labelCls, errorCls, hintCls } from './shared';

/** Aplana el árbol a "Padre > Hija" para el desplegable. */
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

// La etiqueta dice lo que la opción HACE. Se llamaba «Destacados primero» y desde la Política
// de ordenación C (RÁFAGA 1) no destaca nada: ordena por `max(publishedAt, bumpedAt)`, es
// decir, recién publicados y recién reimpulsados. El VALOR sigue siendo 'featured' porque está
// persistido en los bloques ya publicados; renombrarlo obligaría a migrar contenido para no
// ganar nada. Ver lib/home-blocks/resolve-listings.ts y docs/diseno-rotacion-destacados.md §10.2.
export const SORT_OPTIONS: { value: ListingsSort; label: string }[] = [
  { value: 'recent', label: 'Los más recientes' },
  { value: 'featured', label: 'Recientes o reimpulsados' },
];

/** Valor del <select> que significa "sin filtrar por categoría". */
const TODAS = '';

export function ListingsHomeBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HomeListingsBlock;
  onChange: (patch: Partial<HomeListingsBlock>) => void;
  disabled?: boolean;
}) {
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [checking, setChecking] = useState(false);
  const [sinAnuncios, setSinAnuncios] = useState(false);

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(flattenCategories(cats)))
      .catch(() => setCategories([]));
  }, []);

  // Aviso de "esta categoría no tiene anuncios ahora mismo": el bloque se OCULTA
  // en la portada cuando la consulta no devuelve nada, así que el admin tiene que
  // enterarse AQUÍ y no descubrirlo mirando la web. Reutiliza el mismo search()
  // público con hitsPerPage:1 —solo para leer totalHits—, ninguna fuente nueva.
  // Molde ListingsBlockEditor del blog.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    search({
      ...(block.categorySlug ? { category: block.categorySlug } : {}),
      hitsPerPage: 1,
    })
      .then((res) => {
        if (!cancelled) setSinAnuncios(res.totalHits === 0);
      })
      .catch(() => {
        if (!cancelled) setSinAnuncios(false);
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
          placeholder="p.ej. Recién publicados"
          data-testid="listings-title"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>¿Qué anuncios?</label>
        <select
          value={block.categorySlug ?? TODAS}
          onChange={(e) => onChange({ categorySlug: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          data-testid="listings-category"
        >
          {/* "Todas" NO es un caso raro: es el principal en la portada, y por eso
              va el primero y es lo que trae un bloque recién añadido. */}
          <option value={TODAS}>De todo el sitio</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              Solo de {c.label}
            </option>
          ))}
        </select>
        {!checking && sinAnuncios && (
          <p className={errorCls} data-testid="listings-sin-anuncios">
            <AlertCircle className="h-3 w-3 shrink-0" />
            No hay anuncios que mostrar ahora mismo — el bloque no aparecerá en la portada hasta
            que los haya.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Cuántos</label>
          <select
            value={block.limit}
            onChange={(e) => onChange({ limit: Number(e.target.value) as ListingsLimit })}
            className={inputCls}
            disabled={disabled}
            data-testid="listings-limit"
          >
            {LISTINGS_LIMITS.map((n) => (
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
            onChange={(e) => onChange({ sort: e.target.value as ListingsSort })}
            className={inputCls}
            disabled={disabled}
            data-testid="listings-sort"
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
          data-testid="listings-show-all"
        />
        Mostrar enlace &quot;Ver todos&quot;
      </label>
      <p className={hintCls}>
        Lleva a la búsqueda; si has elegido una categoría, a la página de esa categoría.
      </p>
    </div>
  );
}
