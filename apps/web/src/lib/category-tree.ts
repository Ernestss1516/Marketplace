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

/** Lo que hace falta para aplanar: además del recorrido, el nombre que se lee. */
export interface CategoryNamedNode extends CategoryTreeNode {
  name: string;
  children?: CategoryNamedNode[] | undefined;
}

/**
 * Una fila del árbol aplanado: el nodo, su sitio en la jerarquía y cuánto cuelga
 * de él. Las tres cosas SEPARADAS a propósito — ver `aplanarArbol`.
 */
export interface FilaDeArbol {
  slug: string;
  /** El nombre propio del nodo: «Coches». */
  nombre: string;
  /** Nombres de los ancestros, de la RAÍZ al padre inmediato. `[]` en las raíces. */
  ancestros: string[];
  /** Cuántos nodos cuelgan de éste, a cualquier profundidad. `0` en las hojas. */
  nDescendientes: number;
}

/**
 * ══ EL ÁRBOL, EN UNA LISTA PLANA CON SU RUTA ═════════════════════════════════════
 *
 * De `[{Vehículos, children:[{Coches, children:[{Deportivos}]}]}]` sale
 *
 *   [ {nombre:'Vehículos',  ancestros:[],                     nDescendientes:2},
 *     {nombre:'Coches',     ancestros:['Vehículos'],          nDescendientes:1},
 *     {nombre:'Deportivos', ancestros:['Vehículos','Coches'], nDescendientes:0} ]
 *
 * ── DE DÓNDE VIENE ────────────────────────────────────────────────────────────────
 *
 * Era una función privada de `CategorySelect` (PROFUNDIDAD N · RÁFAGA 2), y sube aquí
 * por lo mismo que subieron las otras cuatro: **que subir o bajar por la jerarquía
 * tenga UN solo sitio donde vivir**. Con un segundo consumidor a punto de llegar —el
 * diálogo de categoría del buscador de portada, BQ-B— la alternativa era tener dos
 * recorridos parecidos y la certeza de que un día dirían cosas distintas.
 *
 * ── POR QUÉ DEVUELVE TRES CAMPOS Y NO LA ETIQUETA YA COMPUESTA ───────────────────
 *
 * La versión de `CategorySelect` devolvía `{slug, etiqueta:'Vehículos › Coches'}`, y
 * hacía bien: **un `<option>` sólo tiene texto**, así que no había nada que separar.
 *
 * Un diálogo sí: pinta el nombre y la ruta en columnas distintas, y —lo que de verdad
 * obliga a separarlos— **filtra sobre el NOMBRE y no sobre la ruta**. Buscando en la
 * ruta, teclear «veh» devuelve la rama entera de Vehículos (todos sus descendientes la
 * llevan en el path) y el filtro deja de filtrar justo en el caso más común
 * (`docs/diseno-buscador.md` §3.3). Componer es trivial y descomponer no lo es, así que
 * la función devuelve las piezas y cada consumidor arma lo suyo.
 *
 * `nDescendientes` viene del mismo recorrido —no de un `conDescendientes` por fila, que
 * sería cuadrático— y existe para poder decir «y sus 6 subcategorías» donde el `<select>`
 * decía «Todo en Vehículos» (decisión 6 del diseño).
 *
 * ── EL ORDEN ES EL DEL ÁRBOL ─────────────────────────────────────────────────────
 *
 * Cada rama entera antes de la siguiente, padres antes que hijos — el mismo de
 * `recorrerArbol`. Así una lista de 2 niveles se sigue leyendo exactamente igual que
 * antes de que el árbol admitiera cuatro.
 */
export function aplanarArbol<T extends CategoryNamedNode>(
  nodos: T[],
  ancestros: string[] = [],
): FilaDeArbol[] {
  return nodos.flatMap((nodo) => {
    const hijos = aplanarArbol((nodo.children ?? []) as T[], [...ancestros, nodo.name]);
    return [
      { slug: nodo.slug, nombre: nodo.name, ancestros, nDescendientes: hijos.length },
      ...hijos,
    ];
  });
}
