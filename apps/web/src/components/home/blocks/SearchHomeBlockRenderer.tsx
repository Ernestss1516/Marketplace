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
 * es `'use client'`, pero React lo renderiza en el servidor: su markup **está
 * entero en el HTML servido**, así que se pinta antes de que se ejecute una sola
 * línea de JS. Es el patrón de isla sobre contenido ya presente que exige el
 * diseño (§3 de las decisiones de partida).
 *
 * ⚠ «ESTÁ EN EL HTML SERVIDO» Y «FUNCIONA SIN JS» SON DOS COSAS DISTINTAS, y este
 * comentario las daba por la misma. La primera es que el navegador puede PINTARLO
 * sin ejecutar nada; la segunda, que se puede INTERACTUAR con ello antes de
 * hidratar. Lo que sostiene el LCP —que es un evento de pintura— es la primera:
 * un elemento que todavía no responde pinta igual de rápido que uno que sí.
 *
 * La distinción importa porque la segunda mitad **deja de ser cierta en BQ-B**:
 * los dos `<select>` de categoría y provincia pasan a ser diálogos filtrables y
 * requieren JS (`docs/diseno-buscador.md` §8, decisión 1). El LCP no se mueve por
 * ello —los disparadores siguen viajando en el HTML y el contenido del diálogo no
 * se pinta hasta abrirlo—, y la degradación sin JS **ya era parcial**: sin JS, el
 * `<select>` de categoría tampoco llevaba a `/vehiculos/coches`, porque
 * `SearchBar.navegar()` no corría.
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

  /**
   * ESCAPARATE D — EL BUSCADOR MONTADO SOBRE LA BANDA.
   *
   * Con la casilla, el bloque sube y se solapa con el hero; sin ella, se queda donde
   * estaba. Tres detalles que hacen que funcione y no rompa nada:
   *
   *  · `-mt-[5.5rem]` = los 48 px de `py-12` del contenedor de bloques MÁS unos 40 de
   *    solape real. Es una clase LITERAL porque Tailwind purga lo que no ve escrito.
   *  · `relative` para pintar POR ENCIMA del fondo de la banda. No hace falta z-index:
   *    dos elementos posicionados se apilan en orden de documento y éste va después.
   *  · La banda tiene `overflow-hidden` (por el patrón), pero eso NO recorta esto: el
   *    buscador es hermano suyo, no descendiente.
   *
   * ⚠ SI EL BUSCADOR NO ES EL PRIMER BLOQUE, el margen negativo se come al anterior. El
   * bloque no puede saberlo —no conoce su índice— así que el aviso vive en el editor,
   * junto a la casilla. Es feo, no roto, y es la consecuencia aceptada de no dejar que
   * un bloque deduzca dónde está.
   */
  const montado = block.overlapHero
    ? 'relative -mt-[5.5rem] md:-mt-[6.5rem]'
    : '';

  return (
    <div className={montado}>
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
