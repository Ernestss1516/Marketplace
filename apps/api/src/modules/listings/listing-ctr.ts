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

/**
 * EL UMBRAL. 100 apariciones.
 *
 * No es redondo por casualidad, pero tampoco es un número mágico: es donde el porcentaje
 * **deja de ser absurdo**, no donde se vuelve preciso. Con 100 apariciones y un CTR
 * observado del 5%, el intervalo de confianza del 95% (Wilson) va de ~1,2% a ~10,3%:
 * sigue siendo ancho, pero el número ya no salta de 0% a 33% con cada búsqueda que pasa,
 * que es lo que ocurre por debajo de la veintena.
 *
 * Y es alcanzable: una sola página de resultados sirve hasta 24 apariciones, así que un
 * anuncio en una categoría con tráfico cruza las 100 en cuestión de horas. Cuando NO las
 * cruza, la ausencia del dato también informa: ese anuncio no está saliendo en las
 * búsquedas de nadie.
 */
export const CTR_MIN_IMPRESSIONS = 100;

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
    value: impressions >= CTR_MIN_IMPRESSIONS ? views / impressions : null,
    views,
    impressions,
  };
}
