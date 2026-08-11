import type { Category, TagRef } from '@/types';
import { conDescendientes, recorrerArbol } from '@/lib/category-tree';

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
  // PROFUNDIDAD N — RÁFAGA 3: todo el árbol, no «raíces + un nivel».
  return unir(...recorrerArbol(categories).map((cat) => cat.tags));
}

/**
 * Una categoría concreta. Misma regla que `filterableFieldsForCategory` y que
 * `getAttributeTypesForCategory` en el backend:
 *  - HOJA: sus tags efectivos (propios + heredados de sus ancestros, ya resueltos).
 *  - CON DESCENDENCIA: los suyos ∪ los de TODA ella, porque navegarla agrega los
 *    anuncios de toda la subcadena (`categoryPath = slug`), así que un tag de un
 *    descendiente es un filtro legítimo ahí.
 *
 * PROFUNDIDAD N — RÁFAGA 3: eran «las hijas»; ahora es la descendencia entera. Mismo
 * cambio y mismo motivo que en `filterableFieldsForCategory`.
 */
export function availableTagsForCategory(
  categories: Category[],
  slug: string,
): TagRef[] {
  // Slug desconocido → `[]`: sin datos para ofrecer nada, la sección no se pinta.
  return unir(...conDescendientes(categories, slug).map((cat) => cat.tags));
}
