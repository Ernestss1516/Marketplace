import Link from 'next/link';
import type { HomeSearchBlock } from '@/types/home-blocks';
import type { Category } from '@/types';
import { SearchBar } from '@/components/busqueda/SearchBar';
import { categoryPath } from '@/lib/category-url';

/** Chips "Populares" cuando el bloque no fija `popularCount`. Es el valor que la
 *  home traía escrito a mano (POPULAR_CATEGORY_COUNT). */
const DEFAULT_POPULAR_COUNT = 6;

/**
 * Bloque `search` de portada. **Server Component** — el `SearchBar` que monta sí
 * es `'use client'`, pero su markup es un `<form>` nativo con dos `<select>` y un
 * `<input type="search">`: **está entero en el HTML servido y funciona sin JS**.
 * El JS solo añade las sugerencias de etiquetas y la navegación con flechas. Es
 * el patrón de isla sobre contenido ya presente que exige el diseño (§3 de las
 * decisiones de partida).
 *
 * El árbol de categorías NO se consulta aquí: lo carga una sola vez el Server
 * Component de la página y baja por props, igual que `SearchBar` ya lo recibía
 * cuando estaba escrito a mano en la home (SearchBar.tsx:14 — "pasadas por el
 * llamador, sin query propia").
 *
 * `eyebrow` y los chips de categorías populares viven en este bloque y no en el
 * hero: son vecindad del buscador, no del titular (docs/diseno-portada.md §4.1).
 */
export function SearchHomeBlockRenderer({
  block,
  categories = [],
}: {
  block: HomeSearchBlock;
  categories?: Category[];
}) {
  const popular = block.showPopularCategories
    ? categories.slice(0, block.popularCount ?? DEFAULT_POPULAR_COUNT)
    : [];

  return (
    <div>
      {block.eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {block.eyebrow}
        </p>
      )}

      <SearchBar categories={categories} />

      {popular.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-muted-foreground">Populares:</span>
          {popular.map((cat) => (
            <Link
              key={cat.id}
              // Nunca se concatena `/${slug}` a mano: la URL canónica de una
              // categoría la construye SIEMPRE categoryPath (regla de proyecto,
              // lib/category-url.ts:5-9).
              href={categoryPath(cat)}
              className="rounded-full border bg-background px-3 py-1 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
