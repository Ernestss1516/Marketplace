/**
 * La regla de publicación de ratios, compartida por el CTR y por el ratio de me gusta.
 *
 * Este fichero existe para que la regla no pueda tener dos comportamientos según quién la
 * llame — que es exactamente lo que pasaba antes: el CTR se callaba con muestra pequeña y
 * el ratio de me gusta, en el mismo panel, no.
 */
import {
  ratioWithMinSample,
  CTR_MIN_IMPRESSIONS,
  LIKE_RATIO_MIN_VIEWS,
} from './sample-threshold';

describe('ratioWithMinSample', () => {
  it('LA MUTACIÓN: 1 me gusta sobre 1 visita NO da 100%, da `null`', () => {
    // El número que el panel publicaba de verdad, y que un test del repo llegó a FIJAR
    // (`h8-c1-listing-stats`, «likeRatio → toBe(1)»).
    expect(ratioWithMinSample(1, 1, LIKE_RATIO_MIN_VIEWS)).toBeNull();
  });

  it('justo por debajo del umbral es `null`; justo en el umbral se publica', () => {
    expect(ratioWithMinSample(1, LIKE_RATIO_MIN_VIEWS - 1, LIKE_RATIO_MIN_VIEWS)).toBeNull();
    expect(ratioWithMinSample(1, LIKE_RATIO_MIN_VIEWS, LIKE_RATIO_MIN_VIEWS)).toBeCloseTo(
      1 / LIKE_RATIO_MIN_VIEWS,
    );
  });

  it('con muestra de sobra devuelve el cociente tal cual', () => {
    expect(ratioWithMinSample(10, 200, CTR_MIN_IMPRESSIONS)).toBeCloseTo(0.05);
  });

  it('un numerador de 0 con muestra suficiente es 0, no `null`', () => {
    // «Sales mucho y no te guarda nadie» es un diagnóstico, no una falta de datos.
    expect(ratioWithMinSample(0, 500, CTR_MIN_IMPRESSIONS)).toBe(0);
  });

  it('una muestra de 0 nunca divide por cero, aunque el umbral fuera 0', () => {
    expect(ratioWithMinSample(0, 0, 0)).toBeNull();
  });

  it('no recorta por arriba: quien pinta decide cómo contar un valor mayor que 1', () => {
    expect(ratioWithMinSample(300, 100, CTR_MIN_IMPRESSIONS)).toBeCloseTo(3);
  });

  describe('los dos umbrales', () => {
    it('el de me gusta es MUCHO más bajo que el del CTR, y no por descuido', () => {
      // Los denominadores no son magnitudes comparables: una aparición es barata (hasta 24
      // por página de resultados) y una visita exige un clic. Copiar el 100 del CTR habría
      // escondido el ratio de me gusta a casi todo el catálogo, que es otra forma de no
      // informar. Ver la justificación en `sample-threshold.ts`.
      expect(LIKE_RATIO_MIN_VIEWS).toBeLessThan(CTR_MIN_IMPRESSIONS);
    });

    it('pero el de me gusta es lo bastante alto para que un solo suceso no lo gobierne', () => {
      // Con N visitas, un me gusta más mueve el ratio 1/N. Por debajo de ~20 el
      // movimiento por suceso pasa de 5 puntos y el porcentaje deja de significar nada.
      expect(1 / LIKE_RATIO_MIN_VIEWS).toBeLessThan(0.05);
    });
  });
});
