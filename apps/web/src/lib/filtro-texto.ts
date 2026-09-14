/**
 * ══ EL FILTRO DE TEXTO, EN UN SOLO SITIO ═════════════════════════════════════════════
 *
 * Las dos mitades de «escribes y la lista se recorta»: cómo se comparan las cadenas y en
 * qué orden salen las que casan. Estaban **dentro** de `MunicipioAutocomplete` —el único
 * sitio del repo donde esto se había resuelto entero— y suben aquí porque BQ-B les trae un
 * segundo consumidor: el `DialogoFiltrable` del buscador de portada.
 *
 * Es el mismo argumento por el que `aplanarArbol` subió a `category-tree.ts` en BQ-A: dos
 * copias parecidas de una regla de ordenación **no dan error cuando divergen**, dan dos
 * listas distintas para la misma búsqueda, y nadie lo nota hasta que alguien compara.
 *
 * Cero cambio de comportamiento: `MunicipioAutocomplete` hacía exactamente esto.
 */

/**
 * Minúsculas y sin acentos, para comparar de forma tolerante.
 *
 * NFD separa cada carácter acentuado (é → e + U+0301) y el reemplazo borra las marcas
 * diacríticas combinantes (U+0300-U+036F). Es lo que hace que «valencia» encuentre
 * `Valencia/València` y «alava» encuentre `Araba/Álava`.
 */
export function normalizarParaFiltrar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * El orden de los resultados, y **no es alfabético a propósito**.
 *
 *  1. Lo que EMPIEZA por lo tecleado va antes que lo que solo lo contiene. Quien escribe
 *     «bar» busca `Barcelona`, no un municipio que lleve «bar» por el medio.
 *  2. A igualdad de grupo, gana el más CORTO: es la coincidencia más ajustada. `Moto`
 *     antes que `Motocicletas de agua`; `Araba/Álava` (11) antes que `Alicante/Alacant`
 *     (16) cuando se teclea «ala» y las dos casan sólo por contención.
 *
 * Recibe las cadenas YA NORMALIZADAS, igual que `q`: normalizar dentro del comparador se
 * haría O(n log n) veces en vez de una por elemento.
 */
export function comparaCoincidencia(q: string): (a: string, b: string) => number {
  return (a, b) => {
    const aEmpieza = a.startsWith(q);
    const bEmpieza = b.startsWith(q);
    if (aEmpieza !== bEmpieza) return aEmpieza ? -1 : 1;
    return a.length - b.length;
  };
}

/**
 * Filtra y ordena en una sola pasada: las entradas cuya cadena buscable CONTIENE `q`,
 * en el orden de `comparaCoincidencia`.
 *
 * `q` llega ya normalizada. Una `q` vacía devuelve la lista **entera y en su orden
 * original** —no ordenada por nada—, que es lo que quiere un diálogo que se abre
 * mostrándolo todo: el orden del árbol o el alfabético de las provincias, no un ranking
 * contra una búsqueda que nadie ha escrito.
 */
export function filtrarPorTexto<T>(
  items: readonly T[],
  q: string,
  buscableDe: (item: T) => string,
): T[] {
  if (!q) return [...items];
  const comparar = comparaCoincidencia(q);
  return items
    .map((item) => ({ item, clave: normalizarParaFiltrar(buscableDe(item)) }))
    .filter(({ clave }) => clave.includes(q))
    .sort((a, b) => comparar(a.clave, b.clave))
    .map(({ item }) => item);
}
