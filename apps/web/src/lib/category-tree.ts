/**
 * PROFUNDIDAD N — RÁFAGA 3. Recorridos del árbol de categorías en el frontend.
 *
 * POR QUÉ EXISTE. Seis ficheros hacían el mismo recorrido a mano —«las raíces y
 * un nivel de hijas»— cada uno con su propio doble bucle: `filter-carry`,
 * `card-attributes`, `filterable-fields`, `available-tags`, `sitemap` y
 * `category-url`. Con 2 niveles eso era correcto; con 4 cada uno de esos bucles
 * es un sitio donde una categoría profunda desaparece **en silencio** (no da
 * error: simplemente no está en el mapa, o no se le calcula la URL).
 *
 * Es el hermano en el cliente de `CategoryTreeService` en el backend, y por la
 * misma razón: que subir o bajar por la jerarquía tenga UN solo sitio donde
 * vivir. Aquí son funciones puras sobre el árbol que ya sirve `GET /categories`,
 * no un servicio: el frontend no consulta la jerarquía, la recibe entera.
 *
 * Todas aceptan `children` ausente (`?? []`): la API lo omite en las hojas y hay
 * consumidores que trabajan con árboles parciales.
 */

/** Lo mínimo que necesita un recorrido. Compatible con `Category` y con los
 *  árboles reducidos que usan algunos consumidores (y sus tests). */
export interface CategoryTreeNode {
  slug: string;
  children?: CategoryTreeNode[] | undefined;
}

/** Todos los nodos del árbol, en orden de recorrido (padres antes que hijos). */
export function recorrerArbol<T extends CategoryTreeNode>(nodos: T[]): T[] {
  return nodos.flatMap((nodo) => [nodo, ...recorrerArbol((nodo.children ?? []) as T[])]);
}

/** Localiza un nodo por slug a cualquier profundidad. */
export function buscarEnArbol<T extends CategoryTreeNode>(nodos: T[], slug: string): T | undefined {
  return recorrerArbol(nodos).find((n) => n.slug === slug);
}

/**
 * Cadena raíz→nodo, ambos incluidos. `[]` si el slug no está en el árbol.
 *
 * Es la operación de la que salen la URL, la miga y el path aplanado del
 * selector: las tres son «la lista de ancestros, en orden».
 */
export function cadenaHasta<T extends CategoryTreeNode>(nodos: T[], slug: string): T[] {
  for (const nodo of nodos) {
    if (nodo.slug === slug) return [nodo];
    const resto = cadenaHasta((nodo.children ?? []) as T[], slug);
    if (resto.length > 0) return [nodo, ...resto];
  }
  return [];
}

/**
 * El nodo y TODOS sus descendientes, a cualquier profundidad.
 *
 * Es lo que hace falta allí donde antes se escribía «la categoría y sus hijas»:
 * navegar una categoría agrega en Meilisearch los anuncios de toda su
 * descendencia (`categoryPath` es contención en array), así que un atributo o un
 * tag de un bisnieto es un filtro legítimo mirando a la raíz.
 */
export function conDescendientes<T extends CategoryTreeNode>(nodos: T[], slug: string): T[] {
  const nodo = buscarEnArbol(nodos, slug);
  return nodo ? recorrerArbol([nodo]) : [];
}
