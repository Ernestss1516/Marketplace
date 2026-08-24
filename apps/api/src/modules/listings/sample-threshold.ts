/**
 * ESTADÍSTICAS — «ESTE PORCENTAJE, ¿SIGNIFICA ALGO?»
 *
 * UNA sola regla para los DOS ratios que el vendedor Pro ve en su panel. Existía sólo
 * para el CTR (A2) y el `likeRatio` de al lado seguía diciendo «un 100% de quienes lo ven
 * lo guardan» sobre UNA visita: el mismo defecto, en la misma pantalla, a tres centímetros
 * del que ya estaba arreglado.
 *
 * El defecto no es de cálculo —los dos cocientes están bien divididos— sino de
 * PUBLICACIÓN: un porcentaje sobre una muestra minúscula es una afirmación rotunda sobre
 * ruido, y quien la lee toma decisiones con ella. Por debajo del umbral no se enseña el
 * número: se dice cuánto falta.
 *
 * ─── POR QUÉ AQUÍ Y NO UNA COPIA EN CADA SITIO ───────────────────────────────────
 *
 * Porque son la misma decisión de negocio, y una copia se habría separado de la otra a la
 * primera revisión de umbrales. Lo que cambia entre los dos ratios es el NÚMERO y las
 * PALABRAS, no el criterio — y por eso los dos números viven juntos aquí abajo, donde se
 * pueden comparar.
 */

/**
 * EL UMBRAL DEL CTR: 100 apariciones (denominador = veces listado).
 *
 * Es donde el porcentaje **deja de ser absurdo**, no donde se vuelve preciso: con un CTR
 * observado del 5%, el intervalo de Wilson al 95% todavía va de ~1,2% a ~10,3%. Lo que
 * compra es que el número deje de saltar de 0% a 33% con cada búsqueda que pasa.
 *
 * Es alcanzable de sobra: una sola página de resultados sirve hasta 24 apariciones, así
 * que un anuncio en una categoría con tráfico cruza las 100 en horas.
 */
export const CTR_MIN_IMPRESSIONS = 100;

/**
 * EL UMBRAL DEL RATIO DE ME GUSTA: 30 visitas (denominador = visitas).
 *
 * ─── POR QUÉ NO 100, COMO EL CTR ─────────────────────────────────────────────────
 *
 * Porque los dos denominadores no son magnitudes comparables, y copiar el número habría
 * hecho inútil la métrica. Una aparición es barata —cada página de resultados reparte
 * hasta 24— mientras que una visita exige que alguien HAGA CLIC. Con un CTR típico de
 * pocos puntos, 100 visitas corresponden a varios miles de apariciones: pedir 100 visitas
 * habría escondido el ratio a casi todos los anuncios del catálogo, que es otra forma de
 * no informar.
 *
 * ─── POR QUÉ 30 ──────────────────────────────────────────────────────────────────
 *
 * Mismo criterio que el del CTR: el punto donde el ratio deja de ser el eco de un único
 * suceso. Con 30 visitas, un «me gusta» más mueve el resultado ~3,3 puntos; con 10, lo
 * mueve 10; con 1, lo mueve de 0% a 100% — que es exactamente el número que se estaba
 * publicando. Y 30 visitas es un anuncio normal, no un anuncio excepcional.
 *
 * Como el del CTR, es un umbral de DECENCIA, no de precisión: con 30 visitas el intervalo
 * de confianza sigue siendo ancho. Lo que garantiza es que el porcentaje ya no sea la
 * traducción de «le ha dado a me gusta una persona».
 */
export const LIKE_RATIO_MIN_VIEWS = 30;

/**
 * El cociente, o `null` si la muestra no da para publicarlo.
 *
 * `sample` es el DENOMINADOR: es su tamaño el que decide si el número es señal o ruido.
 * Devolver `null` —y no un 0, ni el cociente crudo con una bandera al lado— es lo que
 * obliga a quien pinta a tratar el caso: un `null` no se puede formatear como porcentaje
 * por descuido.
 */
export function ratioWithMinSample(
  count: number,
  sample: number,
  minSample: number,
): number | null {
  if (sample < minSample || sample === 0) return null;
  return count / sample;
}
