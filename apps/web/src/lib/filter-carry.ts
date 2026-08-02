import type { Category, ListingTypePolicy } from '@/types';

/**
 * A2 — QUÉ FILTROS SOBREVIVEN AL CAMBIAR DE CATEGORÍA.
 *
 * El problema que resuelve, y que es el eje entero de A2: desde RÁFAGA 1 el backend
 * **rechaza con 400** cualquier query param que no sea core ni un atributo filtrable
 * **de la categoría pedida** (`parseSearchQuery`). Eso es la defensa contra el leak
 * cross-categoría y NO se toca. La consecuencia es que arrastrar la query tal cual al
 * cambiar de categoría rompe la página:
 *
 *   /busqueda?rooms=3   →  elegir "Coches"  →  /vehiculos/coches?rooms=3  →  400
 *
 * (`rooms` es de "pisos"; en /busqueda vale porque sin categoría el resolver usa la
 * unión global, pero en "coches" no existe.)
 *
 * El tránsito padre→hija SÍ era seguro por herencia — es lo que hacía el viejo selector
 * de "Subcategoría" — pero global→categoría y categoría→otra categoría no lo son. Así
 * que el filtrado se hace AQUÍ, en el cliente, antes de navegar: nunca se llega a pedir
 * algo que el backend deba rechazar.
 */

/**
 * Params core: válidos en CUALQUIER categoría, así que sobreviven siempre (con el
 * matiz de `condition`, ver abajo). Espejo de CORE_SEARCH_QUERY_KEYS del backend menos
 * `category` (pasa a ser el path) y `page`/`hitsPerPage` (paginación, no filtro).
 */
const CARRIED_CORE_PARAMS = [
  'q', 'type', 'condition', 'priceType', 'priceUnit',
  'minPrice', 'maxPrice', 'province', 'city',
  'lat', 'lng', 'radius', 'sort',
  // No es un filtro de búsqueda sino de presentación, pero se conserva por la misma
  // razón: cambiar de categoría no debería sacarte de la vista que estabas mirando.
  // Si la vista no está permitida en el destino, `resolveCurrentView` cae al default
  // sin romperse — no hace falta comprobarlo aquí.
  'view',
] as const;

/** Params que se descartan SIEMPRE al cambiar de categoría. */
const DROPPED_PARAMS = [
  // Cambiar de categoría es un cambio de filtro: volver a la página 7 de otra
  // categoría no significa nada. Mismo criterio que `update()` del FilterPanel.
  'page',
  // Pasa a ser el path (/vehiculos/coches), no un query param.
  'category',
] as const;

/**
 * A4 — sufijos de rango numérico. Espejo de `RANGE_SUFFIXES` en el parser del backend
 * (`search-query.parser.ts`): si allí cambian, aquí también.
 */
export const RANGE_SUFFIXES = ['_min', '_max'] as const;

/** `km_min` → `km`. `null` si la clave no es un extremo de rango. */
export function rangeBaseName(key: string): string | null {
  for (const sufijo of RANGE_SUFFIXES) {
    if (key.length > sufijo.length && key.endsWith(sufijo)) return key.slice(0, -sufijo.length);
  }
  return null;
}

/** Categoría destino, o `null` para "Todas las categorías" (→ /busqueda). */
export interface CarryTarget {
  slug: string;
  parentSlug?: string | null;
  /** Política efectiva del destino. Solo se usa para decidir sobre `condition`. */
  allowedListingType?: ListingTypePolicy;
}

/**
 * Nombres de atributo que son FILTRO VÁLIDO en la categoría destino.
 *
 * - Destino **hoja**: sus `allAttributes` filtrables. El backend ya resolvió la
 *   herencia al construir el árbol, así que aquí ya vienen los del padre incluidos.
 * - Destino **raíz**: los suyos ∪ los de todas sus hijas. Replica exactamente la regla
 *   de `getAttributeTypesForCategory` para padres: navegar un padre filtra por
 *   `categoryPath = padre`, que mezcla los anuncios de las hijas, así que un atributo
 *   de hija (p. ej. "fuel" en /vehiculos) es un filtro legítimo ahí.
 * - Destino **null** ("Todas"): `null`, que quien llama interpreta como "no filtres
 *   nada" — /busqueda sin categoría acepta la unión global de atributos.
 *
 * Devolver `null` en vez de un set gigante con toda la unión global es deliberado: el
 * frontend no tiene por qué reconstruir esa unión (y si la reconstruyera mal, tiraría
 * filtros válidos en silencio).
 */
export function filterableAttributeNamesFor(
  tree: Category[],
  targetSlug: string | null,
): ReadonlySet<string> | null {
  if (targetSlug === null) return null;

  const names = new Set<string>();
  const add = (cat: Category | undefined) => {
    for (const attr of cat?.allAttributes ?? []) {
      if (attr.filterable) names.add(attr.key);
    }
  };

  for (const root of tree) {
    if (root.slug === targetSlug) {
      add(root);
      // Raíz: además, todo lo filtrable de sus hijas.
      for (const child of root.children ?? []) add(child);
      return names;
    }
    const child = (root.children ?? []).find((c) => c.slug === targetSlug);
    if (child) {
      add(child);
      return names;
    }
  }

  // Slug desconocido: sin información para decidir, no se arrastra ningún atributo.
  // Conservador a propósito — perder un filtro es recuperable, un 400 no.
  return names;
}

/**
 * Construye la query de destino al cambiar de categoría.
 *
 * @param current  Query actual (la de la URL en la que está el usuario).
 * @param target   Categoría destino, o `null` para "Todas las categorías".
 * @param allowedAttributeNames  Set de atributos válidos en el destino, o `null` para
 *                               "no filtrar" (destino "Todas"). Normalmente el
 *                               resultado de `filterableAttributeNamesFor`.
 */
export function carryFilters(
  current: URLSearchParams,
  target: CarryTarget | null,
  allowedAttributeNames: ReadonlySet<string> | null,
): URLSearchParams {
  const next = new URLSearchParams();

  // `condition` (estado de conservación) no aplica a servicios: un servicio no está
  // "como nuevo". Si el destino es solo-servicio, el filtro no tendría sentido y el
  // panel ni siquiera lo muestra (isServiceContext) — arrastrarlo dejaría un filtro
  // activo, invisible y restrictivo.
  const dropCondition = target?.allowedListingType === 'SERVICE_ONLY';

  for (const key of CARRIED_CORE_PARAMS) {
    if (key === 'condition' && dropCondition) continue;
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  // Atributos de categoría: todo lo que no es core ni descartado explícitamente.
  const known = new Set<string>([...CARRIED_CORE_PARAMS, ...DROPPED_PARAMS]);
  for (const [key, value] of current.entries()) {
    if (known.has(key) || !value) continue;
    // A4 — un extremo de rango (`km_min`) vale donde valga su atributo BASE. Sin esto
    // se caería siempre al cambiar de categoría, porque el set de permitidos contiene
    // `km`, no `km_min`, y el usuario perdería el rango sin motivo.
    const nombreBase = rangeBaseName(key) ?? key;
    // `null` = destino "Todas": la unión global los acepta todos.
    if (allowedAttributeNames === null || allowedAttributeNames.has(nombreBase)) {
      next.set(key, value);
    }
    // Si no está permitido en el destino, se cae EN SILENCIO. Avisar ("hemos quitado
    // 2 filtros") sería ruido en el 99% de los casos: el usuario está cambiando de
    // categoría, no esperando que "habitaciones" siga aplicando a coches.
  }

  return next;
}
