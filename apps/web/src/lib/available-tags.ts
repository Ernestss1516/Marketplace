import type { Category, TagRef } from '@/types';

/**
 * B3 — QUÉ ETIQUETAS OFRECE el panel de filtros en cada ámbito.
 *
 * Hermano de `lib/filterable-fields.ts`, y con el mismo eje: la lista la dicta la
 * CONFIG (qué tags se ofrecen en esta categoría), no el resultado de la búsqueda. Los
 * conteos siguen saliendo de `facets.tags`, así que una etiqueta configurada sin
 * anuncios se pinta con (0) y deshabilitada en vez de desaparecer — criterio F6.
 *
 * La fuente es el árbol de `GET /categories`, donde cada nodo trae ya sus tags
 * EFECTIVOS (la herencia padre→hija la resolvió el backend). No hace falta ninguna
 * llamada extra.
 */

/** Une listas de tags quitando repetidos por slug, conservando el orden de llegada. */
function unir(...listas: (TagRef[] | undefined)[]): TagRef[] {
  const vistos = new Set<string>();
  const resultado: TagRef[] = [];
  for (const lista of listas) {
    for (const tag of lista ?? []) {
      if (vistos.has(tag.slug)) continue;
      vistos.add(tag.slug);
      resultado.push(tag);
    }
  }
  return resultado;
}

/**
 * `/busqueda` sin categoría: la unión de lo que se ofrece en TODO el árbol.
 *
 * No es lo mismo que "el catálogo entero": un tag que existe pero no está asignado a
 * ninguna categoría no lo puede llevar ningún anuncio, así que ofrecerlo como filtro
 * sería ofrecer un callejón sin salida garantizado.
 */
export function availableTagsForTree(categories: Category[]): TagRef[] {
  return unir(
    ...categories.flatMap((root) => [root.tags, ...(root.children ?? []).map((c) => c.tags)]),
  );
}

/**
 * Una categoría concreta. Misma regla que `filterableFieldsForCategory` y que
 * `getAttributeTypesForCategory` en el backend:
 *  - HOJA: sus tags efectivos (propios + heredados del padre, ya resueltos).
 *  - RAÍZ: los suyos ∪ los de sus hijas, porque navegar una raíz agrega los anuncios de
 *    las hijas (`categoryPath = raíz`), así que un tag de hija es un filtro legítimo ahí.
 */
export function availableTagsForCategory(
  categories: Category[],
  slug: string,
): TagRef[] {
  for (const root of categories) {
    if (root.slug === slug) {
      return unir(root.tags, ...(root.children ?? []).map((c) => c.tags));
    }
    const child = (root.children ?? []).find((c) => c.slug === slug);
    if (child) return unir(child.tags);
  }
  // Slug desconocido: sin datos para ofrecer nada. La sección no se pinta.
  return [];
}
