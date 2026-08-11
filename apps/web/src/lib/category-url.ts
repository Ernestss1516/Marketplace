import { cadenaHasta, type CategoryTreeNode } from '@/lib/category-tree';

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
 * Forma canónica — la CADENA DE ANCESTROS completa:
 *   raíz    → /vehiculos
 *   hija    → /vehiculos/coches
 *   nieta   → /vehiculos/coches/deportivos
 *   bisnieta→ /vehiculos/coches/deportivos/clasicos
 *
 * PROFUNDIDAD N — RÁFAGA 3. Antes el árbol era de EXACTAMENTE 2 niveles y esto
 * era un ternario «o hay padre o no lo hay». Ahora admite hasta
 * CATEGORY_MAX_DEPTH niveles.
 *
 * LAS URLS DE 1-2 NIVELES NO CAMBIAN: la fórmula generalizada produce
 * exactamente las mismas cadenas que producía el ternario. Y no pueden cambiar
 * nunca, porque re-parentar una categoría está prohibido (ver el comentario de
 * cabecera de UpdateCategoryDto en la API) — que es justo lo que hace que pasar
 * a N niveles tenga riesgo SEO cero.
 */

/** Lo mínimo que hace falta para construir la URL. Compatible con `Category`,
 *  `CategoryWithSchema` y con el `category` que trae la ficha del anuncio. */
export interface CategoryUrlParts {
  slug: string;
  /**
   * Slugs de los ancestros, de la RAÍZ hacia el padre inmediato (sin incluir la
   * propia categoría). Ausente/vacío = categoría raíz.
   */
  ancestorSlugs?: string[] | null;
  /**
   * Slug del padre inmediato. FORMA ANTERIOR, aceptada a propósito: hay payloads
   * legítimos que sólo la traen —fichas de anuncio servidas desde la caché Redis
   * anterior a un despliegue, y consumidores todavía sin migrar—. Se usa como
   * `ancestorSlugs` de un elemento cuando esta falta.
   */
  parentSlug?: string | null;
}

/**
 * La cadena de ancestros de una `CategoryUrlParts`, venga en la forma nueva o en
 * la vieja. Un solo sitio donde se decide, para que ningún generador de URL
 * tenga que saber que existen dos formas.
 */
function ancestros(cat: CategoryUrlParts): string[] {
  if (cat.ancestorSlugs && cat.ancestorSlugs.length > 0) return cat.ancestorSlugs;
  return cat.parentSlug ? [cat.parentSlug] : [];
}

/**
 * URL canónica de una categoría.
 *
 * Sin ancestros se trata como "es raíz" a propósito, no como un error: un
 * payload cacheado que no los traiga emite la URL plana, que el middleware
 * redirige a la canónica — se degrada a un redirect, nunca a un 404.
 */
export function categoryPath(cat: CategoryUrlParts): string {
  return `/${[...ancestros(cat), cat.slug].join('/')}`;
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
  tree: CategoryTreeNode[],
  slug: string,
): CategoryUrlParts | null {
  // PROFUNDIDAD N — RÁFAGA 3: era un doble bucle (raíces → hijas). Ahora sale de
  // la cadena, que es la misma operación a cualquier profundidad.
  const cadena = cadenaHasta(tree, slug);
  if (cadena.length === 0) return null;
  return {
    slug,
    ancestorSlugs: cadena.slice(0, -1).map((n) => n.slug),
  };
}
