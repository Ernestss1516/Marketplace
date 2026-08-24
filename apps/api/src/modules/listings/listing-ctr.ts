/**
 * ESTADÍSTICAS A2 — EL CTR: «de cada N veces que apareces en una búsqueda, cuántas
 * personas entran».
 *
 * Función pura y en su propio fichero por dos razones: es una REGLA DE NEGOCIO (cuándo un
 * número es publicable y cuándo es ruido), así que vive en el backend y no en la
 * presentación; y es la parte de las estadísticas Pro que se puede equivocar en silencio,
 * así que conviene poder probarla sin montar media aplicación.
 *
 * ─── LOS DOS PROBLEMAS QUE RESUELVE, Y QUE NO SON OBVIOS ─────────────────────────
 *
 * **1. `viewCount / impressionCount` DA BASURA, y no un poco: durante meses.** Los dos
 * totales miden ventanas distintas. `Listing.viewCount` acumula desde H8.C1;
 * `Listing.impressionCount` empezó a contar el día que se desplegó A1. Un anuncio con
 * 3.000 visitas de un año y 120 apariciones de ayer daría un CTR del 2.500%. No es un
 * caso raro: es el estado de TODOS los anuncios del catálogo el día del despliegue.
 *
 * Por eso el CTR **no se calcula con los totales**, sino sumando las dos series diarias
 * sobre la **ventana comparable**: desde el primer día en que hay impresiones. Se corrige
 * solo — a los 30 días de tener A1 en marcha, la ventana comparable ES la de la gráfica.
 *
 * **2. UN PORCENTAJE SOBRE POCAS APARICIONES ENGAÑA.** «2 visitas de 3 apariciones = 67%»
 * es un número construido sobre ruido: la siguiente aparición lo mueve veinte puntos. Un
 * vendedor que lea 67% y decida no tocar su anuncio habrá tomado una decisión sobre nada.
 *
 * Por debajo de `CTR_MIN_IMPRESSIONS` el valor es `null` y la interfaz dice cuántas
 * apariciones faltan, en vez de enseñar un porcentaje rotundo.
 */

// EL UMBRAL y la regla de publicación viven en `sample-threshold.ts`, junto al del ratio
// de me gusta: son la MISMA decisión de negocio aplicada a dos cocientes, y tenerlos
// juntos es lo que permite comparar los dos números y razonar por qué no son iguales.
// Se re-exporta porque este módulo es la puerta natural de todo lo relativo al CTR.
import { CTR_MIN_IMPRESSIONS, ratioWithMinSample } from './sample-threshold';

export { CTR_MIN_IMPRESSIONS };

export interface DailyPoint {
  date: Date;
  count: number;
}

export interface CtrSummary {
  /** Visitas ÷ apariciones en la ventana comparable. `null` = aún no hay muestra. */
  value: number | null;
  /** Visitas contadas en esa ventana (no el total histórico del anuncio). */
  views: number;
  /** Apariciones contadas en esa ventana. */
  impressions: number;
  /** El umbral, servido para que la interfaz pueda decir «te faltan N» sin cablearlo. */
  minImpressions: number;
}

/**
 * Calcula el CTR a partir de las DOS series diarias, no de los totales (ver cabecera).
 *
 * Puede dar un valor **mayor que 1**, y no es un error que haya que tapar: significa que
 * el anuncio recibe más visitas que apariciones en búsqueda, porque le llegan por otras
 * vías —enlace directo, favoritos, el perfil del vendedor, un bloque de portada (que a
 * propósito no cuenta impresiones)—. Recortarlo a 100% escondería justo esa lectura, que
 * es información útil. Quien lo pinta se encarga de contarlo bien.
 */
export function computeCtr(
  dailyViews: ReadonlyArray<DailyPoint>,
  dailyImpressions: ReadonlyArray<DailyPoint>,
): CtrSummary {
  const base = { minImpressions: CTR_MIN_IMPRESSIONS };

  if (dailyImpressions.length === 0) {
    return { ...base, value: null, views: 0, impressions: 0 };
  }

  // El primer día con impresiones marca el principio de la ventana comparable. Las
  // visitas anteriores a él existieron, pero no tienen apariciones contra las que
  // medirse: contarlas inflaría el numerador con tráfico de una época sin denominador.
  const desde = dailyImpressions.reduce(
    (min, fila) => (fila.date < min ? fila.date : min),
    dailyImpressions[0].date,
  );

  const impressions = dailyImpressions.reduce((suma, fila) => suma + fila.count, 0);
  const views = dailyViews
    .filter((fila) => fila.date >= desde)
    .reduce((suma, fila) => suma + fila.count, 0);

  return {
    ...base,
    // La regla de «¿esto se puede publicar?» es compartida con el ratio de me gusta.
    value: ratioWithMinSample(views, impressions, CTR_MIN_IMPRESSIONS),
    views,
    impressions,
  };
}
