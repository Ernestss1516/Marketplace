import {
  ESTILO_ZONES,
  MODELO_0,
  MODELO_PRUEBA,
  MODELOS,
  MODELOS_DE_PRUEBA,
  TODOS_LOS_MODELOS,
  buscarModelo,
  resolverTokens,
  resolverZona,
  validarContraste,
  zonaSoloAjusta,
  type Tokens,
} from './estilo.constants';
import { AA_INTERFAZ, AA_TEXTO, contraste, cumpleTexto } from './color';

/**
 * E6 — LA CAPA DE CONTRASTE EN CI (§10.5 del diseño).
 *
 * ── POR QUÉ EXISTE ESTE FICHERO, Y NO ESTABA ─────────────────────────────────────────
 *
 * Lo prometía el código: el comentario de `parejasBloqueantes` dice, palabra por palabra,
 * que los semánticos «no se comprueban» en el guardado y que su contraste «se comprueba
 * una vez por modelo, en CI (`contraste-modelos.spec.ts`)». **Ese fichero no existía.**
 * Había una promesa de barrera y ninguna barrera, que es peor que no prometer nada: quien
 * añada un modelo lee ese comentario y da por hecho que alguien le va a medir los avisos.
 *
 * ── QUÉ MIDE, Y POR QUÉ AQUÍ Y NO EN EL GUARDADO ─────────────────────────────────────
 *
 * Dos familias, con destinos distintos:
 *
 *  · LO CONFIGURABLE (los cuatro colores y lo que se deriva de ellos) lo valida
 *    `EstiloService.setConfig` en cada guardado, porque cambia con lo que el admin
 *    elige. Aquí sólo se comprueba de fábrica, para todos los modelos y TODAS SUS ZONAS.
 *  · LOS SEMÁNTICOS (éxito, aviso, error, pendiente, neutro) son FIJOS del modelo: no
 *    dependen de nadie, así que medirlos en cada guardado sería medir siempre lo mismo.
 *    Se miden aquí, UNA VEZ POR MODELO, que es donde un modelo nuevo tiene que demostrar
 *    que es accesible antes de llegar a una instancia.
 *
 * ── EL MODELO DE PRUEBA ENTRA IGUAL ──────────────────────────────────────────────────
 *
 * `MODELO_PRUEBA` no está en el catálogo, pero se mide como cualquier otro. Un modelo de
 * prueba inaccesible enseñaría que la regla se puede esquivar «porque es sólo un test», y
 * la primera excepción a una regla es la que la deroga.
 */

/**
 * Las parejas de los SEMÁNTICOS que llevan texto. Todas a 4,5:1 — son mensajes que se
 * leen, no adornos.
 *
 * Cada aviso se pinta sobre DOS superficies distintas según el sitio (la suave y la
 * plena), así que la letra tiene que valer sobre las dos: un `warning-foreground` que
 * sólo cumpla sobre `warning` deja ilegible la mitad de sus usos.
 */
function parejasSemanticasDeTexto(t: Tokens): readonly [string, string, string][] {
  return [
    ['aviso: letra sobre la superficie suave', t.warning, t['warning-foreground']],
    ['aviso: letra sobre la superficie plena', t['warning-surface'], t['warning-foreground']],
    ['éxito: letra sobre la superficie suave', t.success, t['success-foreground']],
    ['éxito: letra sobre la superficie plena', t['success-surface'], t['success-foreground']],
    ['info: letra sobre la superficie suave', t.info, t['info-foreground']],
    ['info: letra sobre la superficie plena', t['info-surface'], t['info-foreground']],
    ['error: letra sobre la superficie suave', t['destructive-subtle'], t['destructive-strong']],
    ['error: letra sobre el rojo macizo', t.destructive, t['destructive-foreground']],
    // El rojo TAMBIÉN se usa como texto (`text-destructive`), no sólo como relleno. Es
    // la pareja que destapó el segundo fallo: 3,76:1 sobre el lienzo.
    ['error: el rojo como texto sobre el lienzo', t.background, t.destructive],
    ['pendiente: letra sobre su superficie', t['pending-surface'], t['pending-foreground']],
    ['neutro: letra sobre su superficie', t['neutral-surface'], t['neutral-foreground']],
  ];
}

/**
 * ⚠ LOS TRAZOS DE LOS AVISOS SE MIDEN PERO NO BLOQUEAN, por la misma razón normativa
 * que el trazo decorativo de `parejasDeAviso` (ver su comentario en `estilo.constants`):
 * WCAG 1.4.11 exige 3:1 a lo necesario para IDENTIFICAR un componente, y un aviso se
 * identifica por su texto y su superficie, no por su contorno. Se informan para quien
 * diseñe un modelo con personalidad; imponerlos sería inventarse una obligación.
 */
function parejasSemanticasDeTrazo(t: Tokens): readonly [string, string, string][] {
  return [
    ['aviso: trazo sobre su superficie', t.warning, t['warning-border']],
    ['éxito: trazo sobre su superficie', t.success, t['success-border']],
    ['info: trazo sobre su superficie', t.info, t['info-border']],
    ['error: trazo sobre su superficie', t['destructive-subtle'], t['destructive-border']],
  ];
}

describe('Contraste en CI — todos los modelos, catálogo y prueba', () => {
  for (const m of TODOS_LOS_MODELOS) {
    describe(`${m.id} (${m.nombre})`, () => {
      const base = resolverTokens(m, m.coloresPorDefecto);

      it('la paleta de fábrica cumple las parejas bloqueantes', () => {
        expect(validarContraste(base)).toEqual([]);
      });

      /**
       * POR ZONA, y no sólo la base. Una zona puede romper el contraste tan bien como
       * la base: el backoffice del Modelo 0 desatura los grises, y eso bajó el borde de
       * campo a 2,96:1 cuando se escribió — el rojo de esta comprobación fue lo que
       * obligó a compensarlo con luz. Ver `estilo.spec.ts`.
       */
      for (const zona of ESTILO_ZONES) {
        it(`la zona ${zona} sigue cumpliendo tras sus ajustes`, () => {
          const efectiva = { ...base, ...resolverZona(m, m.coloresPorDefecto, zona) };
          expect(validarContraste(efectiva)).toEqual([]);
        });
      }

      /** La regla dura del §5.2, para TODO modelo y no sólo para el 0. */
      it('ninguna de sus zonas inventa un token', () => {
        expect(zonaSoloAjusta(m, m.coloresPorDefecto)).toEqual([]);
      });

      it.each(parejasSemanticasDeTexto(base))(
        'semántico — %s cumple 4,5:1',
        (_nombre, fondo, texto) => {
          expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(AA_TEXTO);
        },
      );

      it('los trazos de los avisos quedan medidos (informativo, no bloquea)', () => {
        // No afirma un mínimo: afirma que TODOS son medibles. Un valor que el conversor
        // de color no sepa leer devuelve un contraste absurdo, y eso sí es un defecto —
        // un token mal escrito que nadie notaría porque «no bloquea».
        const ilegibles = parejasSemanticasDeTrazo(base)
          .map(([nombre, fondo, trazo]) => ({ nombre, ratio: contraste(fondo, trazo) }))
          .filter(({ ratio }) => !Number.isFinite(ratio) || ratio < 1);
        expect(ilegibles).toEqual([]);
      });

      it('los dos colores de letra cubren claro y oscuro', () => {
        const [claro, oscuro] = m.textoSobre;
        expect(contraste('0 0% 0%', claro)).toBeGreaterThanOrEqual(AA_TEXTO);
        expect(contraste('0 0% 100%', oscuro)).toBeGreaterThanOrEqual(AA_TEXTO);
      });
    });
  }
});

/**
 * LA RED DE ESTE FICHERO. Sin esto, las comprobaciones de arriba pasarían igual con una
 * lista de parejas vacía o con un `contraste()` que devolviera siempre 21.
 */
describe('La medición distingue lo ilegible', () => {
  it('un semántico ilegible se caza', () => {
    // Gris medio sobre gris medio: 1:1. Si esto pasara, la lista no mide nada.
    expect(cumpleTexto('#808080', '#808080')).toBe(false);
  });

  it('los umbrales son los de la norma, no unos cualesquiera', () => {
    expect(AA_TEXTO).toBe(4.5);
    expect(AA_INTERFAZ).toBe(3);
  });
});

/**
 * ══ EL MODELO DE PRUEBA: LO QUE TIENE QUE SER Y LO QUE NO ═════════════════════════════
 */
describe('El modelo de prueba existe, resuelve y NO se ofrece', () => {
  it('no aparece en el catálogo público', () => {
    expect(MODELOS.map((m) => m.id)).not.toContain(MODELO_PRUEBA.id);
    expect(MODELOS_DE_PRUEBA.map((m) => m.id)).toContain(MODELO_PRUEBA.id);
  });

  it('pero `buscarModelo` sí lo encuentra — el test de invariancia lo activa por la vía real', () => {
    expect(buscarModelo(MODELO_PRUEBA.id)?.id).toBe(MODELO_PRUEBA.id);
  });

  /**
   * LA PROPIEDAD QUE HACE ÚTIL AL MODELO DE PRUEBA: que sea EXTREMO. Un segundo modelo
   * parecido al primero haría pasar el test de invariancia por casualidad — no porque la
   * frontera se respete, sino porque no había nada que reorganizar.
   *
   * Se afirma con números y no con adjetivos: el lienzo tiene que estar en la otra
   * mitad de la escala de luz, y la letra también.
   */
  it('es DE VERDAD extremo respecto al Modelo 0', () => {
    const cero = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);
    const prueba = resolverTokens(MODELO_PRUEBA, MODELO_PRUEBA.coloresPorDefecto);

    // El lienzo del Modelo 0 es blanco; el del de prueba tiene que ser oscuro.
    expect(contraste(cero.background, prueba.background)).toBeGreaterThanOrEqual(10);
    // Y la letra, al revés.
    expect(contraste(cero.foreground, prueba.foreground)).toBeGreaterThanOrEqual(10);
    // Ejes: ni la tipografía, ni el radio, ni el tempo, ni el trazo del icono coinciden.
    expect(prueba['font-sans']).not.toBe(cero['font-sans']);
    expect(prueba.radius).not.toBe(cero.radius);
    expect(prueba['motion-duration']).not.toBe(cero['motion-duration']);
    expect(prueba['icon-stroke']).not.toBe(cero['icon-stroke']);
  });

  /**
   * EL JUEGO DE NOMBRES ES EL MISMO, y esto es más que higiene.
   *
   * Si un modelo declarara MENOS tokens que otro, las pantallas caerían a `globals.css`
   * para los que faltan y el resultado sería un tema mezclado: mitad modelo nuevo, mitad
   * Modelo 0, sin que nada avisara. Y si declarara MÁS, ese token extra no lo consumiría
   * nadie —ningún componente lo conoce— salvo que alguien tocara componentes para
   * usarlo, que es exactamente cruzar la frontera.
   */
  it('todos los modelos declaran EXACTAMENTE los mismos tokens', () => {
    const referencia = Object.keys(resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto)).sort();
    for (const m of TODOS_LOS_MODELOS) {
      const suyos = Object.keys(resolverTokens(m, m.coloresPorDefecto)).sort();
      expect({ modelo: m.id, tokens: suyos }).toEqual({ modelo: m.id, tokens: referencia });
    }
  });
});
