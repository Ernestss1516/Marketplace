import { resolveEffectiveRequiresReview } from './category.types';

/**
 * MODERACIÓN PREVIA M1 — el pliegue MONÓTONO, fijado donde se define.
 *
 * Lo que hay que proteger no es la operación (es un `||`) sino su PROPIEDAD: que
 * no exista ningún valor que un descendiente pueda poner para deshacer la marca
 * de un ancestro. Si alguien "arreglara" esta función para permitir un override
 * —que es una petición perfectamente razonable de oír algún día— el pliegue
 * dejaría de ser monótono y aparecerían anuncios publicándose sin revisar en
 * ramas marcadas, sin que nada fallara a la vista.
 */

/** Pliega una cadena raíz→hoja, igual que hace el disparador. */
const plegar = (cadena: boolean[]): boolean =>
  cadena.reduce((heredado, propio) => resolveEffectiveRequiresReview(propio, heredado), false);

describe('resolveEffectiveRequiresReview — el pliegue monótono', () => {
  it('sin nadie marcado, no hay revisión', () => {
    expect(plegar([false, false, false, false])).toBe(false);
  });

  it('la marca de la RAÍZ alcanza al bisnieto', () => {
    // Es el caso que un pliegue de un solo nivel se dejaría: la hoja no está
    // marcada y sus dos padres inmediatos tampoco.
    expect(plegar([true, false, false, false])).toBe(true);
  });

  it('un descendiente puede AÑADIR revisión a una rama que no la tenía', () => {
    expect(plegar([false, false, false, true])).toBe(true);
  });

  it('NINGÚN descendiente puede quitar la marca de un ancestro', () => {
    // LA PROPIEDAD QUE IMPORTA. No es que "false no la quite": es que NO EXISTE
    // valor que la quite, porque el único valor posible es el otro y tampoco.
    for (const hoja of [true, false]) {
      for (const intermedio of [true, false]) {
        expect(plegar([true, intermedio, intermedio, hoja])).toBe(true);
      }
    }
  });

  it('es idempotente y no depende del orden en que se apliquen los marcados', () => {
    // Un OR sobre la cadena da lo mismo suba como suba: la garantía es de la
    // operación, no del recorrido.
    expect(plegar([false, true, false])).toBe(plegar([false, false, true]));
    expect(plegar([true, true, true])).toBe(plegar([true, false, false]));
  });
});
