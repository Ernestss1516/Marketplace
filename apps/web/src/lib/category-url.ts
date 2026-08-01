/**
 * A1 — URLs anidadas de categoría. ÚNICA fuente de verdad de la URL de una
 * categoría en todo el frontend.
 *
 * REGLA DE PROYECTO: nadie construye `/${slug}` a mano. Antes de esta ráfaga
 * había 11 sitios que lo hacían (breadcrumbs, rejilla de la portada, paginación,
 * switcher de vistas, selector de subcategoría, ficha del anuncio, bloque CMS,
 * buscador de portada…), cada uno con su propia idea de cómo se escribe la URL.
 * Al pasar a rutas anidadas eso son 11 sitios donde olvidarse del padre.
 *
 * Forma canónica:
 *   raíz  → /vehiculos
 *   hija  → /vehiculos/coches
 *
 * El árbol es de EXACTAMENTE 2 niveles (garantizado en el backend por
 * assertParentIsRoot), así que no hay caso de abuelo: o hay padre o no lo hay.
 */

/** Lo mínimo que hace falta para construir la URL. Compatible con `Category`,
 *  `CategoryWithSchema` y con el `category` que trae la ficha del anuncio. */
export interface CategoryUrlParts {
  slug: string;
  /** Slug del padre. Ausente/null = categoría raíz. */
  parentSlug?: string | null;
}

/**
 * URL canónica de una categoría.
 *
 * `parentSlug` ausente se trata como "es raíz" a propósito, no como un error: hay
 * payloads legítimos que no lo traen (fichas de anuncio servidas desde la caché
 * Redis anterior al despliegue). En ese caso se emite la URL plana, que el
 * catch-all redirige a la canónica — se degrada a un redirect, nunca a un 404.
 */
export function categoryPath(cat: CategoryUrlParts): string {
  return cat.parentSlug ? `/${cat.parentSlug}/${cat.slug}` : `/${cat.slug}`;
}

/**
 * URL canónica con query string. Omite el `?` cuando no hay parámetros — una URL
 * con `?` colgando es una URL distinta para un crawler.
 */
export function categoryPathWithQuery(
  cat: CategoryUrlParts,
  params: URLSearchParams,
): string {
  const query = params.toString();
  return query ? `${categoryPath(cat)}?${query}` : categoryPath(cat);
}

/**
 * Resuelve una categoría (y su padre) por slug dentro del árbol de `GET /categories`.
 * Devuelve `null` si el slug no existe en el árbol.
 *
 * Necesario porque varios generadores solo tienen un slug suelto a mano (el
 * selector de subcategoría, el bloque CMS, el buscador de portada) y necesitan
 * saber si es raíz o hija para construir la URL canónica.
 */
export function findCategoryUrlParts(
  tree: { slug: string; children?: { slug: string }[] }[],
  slug: string,
): CategoryUrlParts | null {
  for (const root of tree) {
    if (root.slug === slug) return { slug: root.slug, parentSlug: null };
    for (const child of root.children ?? []) {
      if (child.slug === slug) return { slug: child.slug, parentSlug: root.slug };
    }
  }
  return null;
}
