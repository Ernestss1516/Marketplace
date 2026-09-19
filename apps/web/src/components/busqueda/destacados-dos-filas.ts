/**
 * CUÁNTOS DESTACADOS CABEN EN DOS FILAS — la tabla, en un solo sitio.
 *
 * ─── QUÉ DECIDE ESTO ─────────────────────────────────────────────────────────────
 *
 * El bloque «Promocionados» enseñaba cuatro tarjetas fijas. Ahora enseña **dos filas
 * llenas**, y como la rejilla cambia de columnas con el ancho, «dos filas» es un número
 * distinto en cada tramo:
 *
 *     < 640 px   →  2 columnas  →  4
 *     640–767    →  3 columnas  →  6
 *     ≥ 768      →  4 columnas  →  8     ← y la rejilla no pasa de cuatro columnas
 *
 * LOS NÚMEROS SALEN DE LA REJILLA, no de una preferencia: son exactamente
 * `grid-cols-2 sm:grid-cols-3 md:grid-cols-4` multiplicado por dos. Si alguien cambia esas
 * columnas, **tiene que cambiar esta tabla o el bloque dejará de enseñar dos filas** — de ahí
 * que vivan a la vista una de otra y que haya un test que las mire juntas.
 *
 * ─── POR QUÉ EL RECORTE ES CSS Y NO JAVASCRIPT ───────────────────────────────────
 *
 * Las dos páginas que pintan el bloque son de SERVIDOR, y el servidor no conoce el viewport.
 * Las salidas eran tres: que el cliente mida y recorte (salto visible justo en la pantalla de
 * resultados, que es donde más molesta), no tocar nada (el escritorio se queda como está), o
 * **mandar hasta ocho y que el CSS enseñe los que caben**. La tercera es la única que llega
 * con el HTML ya correcto: cero JavaScript, cero salto, y el mismo marcado en servidor y en
 * cliente.
 *
 * ─── POR QUÉ POR ÍNDICE Y NO CON `nth-child` ─────────────────────────────────────
 *
 * La rejilla podría recortarse con variantes arbitrarias sobre `nth-child`, pero entonces qué
 * tarjeta se ve dependería de **en qué orden emite Tailwind sus reglas** (varias casan sobre
 * la misma tarjeta y gana la última). Aquí el componente ya está recorriendo la lista, así que
 * cada tarjeta sabe su sitio y se le pone su clase: se lee de un vistazo y no hay conflicto
 * que resolver.
 *
 * ─── NUNCA RELLENA ───────────────────────────────────────────────────────────────
 *
 * Esto sólo OCULTA lo que sobra. Lo que se ve es `min(destacados que existen, lo que cabe)`:
 * con tres destacados se ven tres y la sección ocupa una fila corta; con cinco se ven cinco
 * —una fila llena y una con uno—, porque dos filas es el TOPE y no la obligación de llenarlas.
 * Recortar los cinco a cuatro para que la rejilla quedara cuadrada sería esconder a un
 * vendedor que ha pagado, por estética.
 */

/** Las columnas de la rejilla del bloque en cada tramo. Espejo de sus clases de Tailwind. */
export const COLUMNAS_POR_TRAMO = { base: 2, sm: 3, md: 4 } as const;

/** Dos filas llenas en cada tramo. El mayor (8) es además el tope que sirve el servidor. */
export const VISIBLES_POR_TRAMO = {
  base: COLUMNAS_POR_TRAMO.base * 2,
  sm: COLUMNAS_POR_TRAMO.sm * 2,
  md: COLUMNAS_POR_TRAMO.md * 2,
} as const;

/** Lo máximo que puede llegar a verse, y lo máximo que el servidor manda. */
export const MAXIMO_VISIBLE = VISIBLES_POR_TRAMO.md;

/**
 * La clase de la tarjeta que ocupa la posición `indice` (0-indexado).
 *
 * Cadena vacía = se ve siempre. `hidden sm:block` = a partir de tabletas. Los índices por
 * encima del máximo se ocultan del todo: no deberían llegar —el servidor recorta—, pero una
 * tarjeta de más colándose en una tercera fila sería justo lo que este bloque no debe hacer.
 */
export function claseDeRevelado(indice: number): string {
  if (indice < VISIBLES_POR_TRAMO.base) return '';
  if (indice < VISIBLES_POR_TRAMO.sm) return 'hidden sm:block';
  if (indice < VISIBLES_POR_TRAMO.md) return 'hidden md:block';
  return 'hidden';
}
