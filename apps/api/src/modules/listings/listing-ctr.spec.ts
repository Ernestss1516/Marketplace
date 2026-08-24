/**
 * ESTADÍSTICAS A2 — la regla del CTR: cuándo el número es señal y cuándo es ruido.
 *
 * Los dos casos que este fichero existe para impedir están en `listing-ctr.ts`: el
 * porcentaje de tres cifras que sale de dividir dos totales que miden ventanas distintas,
 * y el «67%» construido sobre tres apariciones.
 */
import { computeCtr, CTR_MIN_IMPRESSIONS } from './listing-ctr';

const dia = (iso: string, count: number) => ({ date: new Date(`${iso}T00:00:00.000Z`), count });

/** Reparte `total` apariciones en un día, para llegar al umbral sin escribir 100 filas. */
const impresiones = (iso: string, total: number) => [dia(iso, total)];

describe('computeCtr — el CTR de las estadísticas Pro', () => {
  describe('el umbral de muestra', () => {
    it('LA MUTACIÓN: 2 visitas de 3 apariciones NO da «67%», da `null`', () => {
      // Sin umbral, esto pintaría un 67% rotundo sobre ruido puro: la cuarta aparición
      // lo movería veinte puntos. El vendedor tomaría una decisión sobre nada.
      const ctr = computeCtr([dia('2026-08-20', 2)], [dia('2026-08-20', 3)]);

      expect(ctr.value).toBeNull();
      // Pero los conteos SÍ viajan: la interfaz necesita poder decir «llevas 3 de 100».
      expect(ctr.impressions).toBe(3);
      expect(ctr.views).toBe(2);
      expect(ctr.minImpressions).toBe(CTR_MIN_IMPRESSIONS);
    });

    it('justo por debajo del umbral sigue siendo `null`', () => {
      const ctr = computeCtr(
        [dia('2026-08-20', 5)],
        impresiones('2026-08-20', CTR_MIN_IMPRESSIONS - 1),
      );

      expect(ctr.value).toBeNull();
    });

    it('justo en el umbral ya se calcula', () => {
      const ctr = computeCtr(
        [dia('2026-08-20', 5)],
        impresiones('2026-08-20', CTR_MIN_IMPRESSIONS),
      );

      expect(ctr.value).toBeCloseTo(5 / CTR_MIN_IMPRESSIONS);
    });

    it('sin ninguna aparición no hay CTR, y tampoco una división por cero', () => {
      const ctr = computeCtr([dia('2026-08-20', 7)], []);

      expect(ctr.value).toBeNull();
      expect(ctr.impressions).toBe(0);
      expect(ctr.views).toBe(0);
    });
  });

  describe('la ventana comparable', () => {
    it('LA MUTACIÓN: las visitas ANTERIORES a la primera aparición no cuentan', () => {
      // Es el estado de todo el catálogo el día que se desplegó A1: años de visitas y
      // un día de apariciones. Dividir los totales daría un 3.000% — y no una vez, sino
      // durante meses. La ventana empieza donde empieza el denominador.
      const vistas = [
        dia('2026-01-01', 2000), // un año de visitas, sin apariciones que las midieran
        dia('2026-08-20', 5),
      ];
      const ctr = computeCtr(vistas, impresiones('2026-08-20', 100));

      expect(ctr.views).toBe(5);
      expect(ctr.value).toBeCloseTo(0.05);
    });

    it('las visitas del mismo día en que empiezan las apariciones SÍ cuentan', () => {
      const ctr = computeCtr([dia('2026-08-20', 10)], impresiones('2026-08-20', 200));

      expect(ctr.views).toBe(10);
      expect(ctr.value).toBeCloseTo(0.05);
    });

    it('con la ventana ya asentada, suma todos los días de las dos series', () => {
      const ctr = computeCtr(
        [dia('2026-08-20', 4), dia('2026-08-21', 6)],
        [dia('2026-08-20', 120), dia('2026-08-21', 80)],
      );

      expect(ctr.views).toBe(10);
      expect(ctr.impressions).toBe(200);
      expect(ctr.value).toBeCloseTo(0.05);
    });

    it('no le importa el orden de las filas para decidir dónde empieza la ventana', () => {
      const ctr = computeCtr(
        [dia('2026-08-19', 999), dia('2026-08-21', 3)],
        [dia('2026-08-21', 50), dia('2026-08-20', 60)],
      );

      // La primera aparición es la del día 20, aunque venga segunda en la lista: las
      // 999 visitas del 19 quedan fuera.
      expect(ctr.views).toBe(3);
      expect(ctr.impressions).toBe(110);
    });
  });

  it('un valor mayor que 1 NO se recorta: significa que el tráfico llega por otras vías', () => {
    // Enlace directo, favoritos, el perfil del vendedor o un bloque de portada (que a
    // propósito no cuenta impresiones). Recortarlo a 100% escondería esa lectura, que es
    // justo la útil. Quien lo pinta es quien tiene que contarlo bien.
    const ctr = computeCtr([dia('2026-08-20', 300)], impresiones('2026-08-20', 100));

    expect(ctr.value).toBeCloseTo(3);
  });

  it('cero visitas sobre apariciones suficientes es un CTR de 0, no un `null`', () => {
    // «Sales mucho y no entra nadie» es un diagnóstico, no una falta de datos: es
    // probablemente el hallazgo más accionable que estas estadísticas pueden dar.
    const ctr = computeCtr([], impresiones('2026-08-20', 500));

    expect(ctr.value).toBe(0);
  });
});
