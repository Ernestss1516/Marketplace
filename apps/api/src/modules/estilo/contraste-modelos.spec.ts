import {
  ESTILO_ZONES,
  MODELO_0,
  MODELO_PRUEBA,
  MODELOS,
  MODELOS_DE_PRUEBA,
  TODOS_LOS_MODELOS,
  buscarModelo,
  coherenciaDePolaridad,
  completitudDeSuperficies,
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
      /**
       * ⚠ POR VERSIÓN, Y NO SÓLO POR MODELO (E13).
       *
       * Hasta que hubo un modelo con dos versiones, esto medía `resolverTokens(m, …)` sin
       * versión y era suficiente: la versión no entraba en la resolución, así que todas
       * daban el mismo tema. Ahora una versión REDEFINE la rampa —`calido-editorial@tarde`
       * baja el lienzo de 97,5 % a 94 % de luz— y eso mueve TODAS las parejas que se miden
       * contra el fondo. Medir sólo la primera dejaría la segunda sin barrera, que es
       * justo el modo de fallo que esta suite existe para impedir.
       *
       * Con `MODELO_0` y `MODELO_PRUEBA` —una versión cada uno, sin `porVersion`— esto
       * mide exactamente lo que medía antes.
       */
      for (const { id: version } of m.versiones) {
        describe(`versión ${version}`, () => {
          const base = resolverTokens(m, m.coloresPorDefecto, version);

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
              const efectiva = {
                ...base,
                ...resolverZona(m, m.coloresPorDefecto, zona, version),
              };
              expect(validarContraste(efectiva)).toEqual([]);
            });
          }

          /**
           * ⚠ EL ROJO SOBRE EL LIENZO, MEDIDO POR VERSIÓN — Y ES UN AGUJERO QUE ESTUVO
           * ABIERTO HASTA QUE ALGUIEN INTENTÓ UNA VERSIÓN OSCURA.
           *
           * Los semánticos se miden más abajo UNA VEZ POR MODELO, sin versión, y para
           * casi todas las parejas eso es correcto: son valores fijos que se comparan
           * entre sí (`warning` contra `warning-foreground`) y la versión no los toca.
           *
           * PERO UNA DE ELLAS NO SE COMPARA CONTRA OTRO SEMÁNTICO: `destructive` se usa
           * también como TEXTO sobre el lienzo, y el lienzo SÍ es de la versión. Medirla
           * sin versión es medirla contra un fondo que puede no existir en la mitad de
           * las versiones del modelo.
           *
           * Se destapó construyendo «Premium Oscuro contenido»: los semánticos son del
           * MODELO y una versión no puede redefinirlos, así que una versión de lienzo
           * carbón heredaría el rojo medio pensado para blanco — que es exactamente el
           * fallo que `MODELO_PRUEBA` documenta en su propio comentario («en un tema claro
           * el rojo tiene que ser oscuro para leerse, y en uno oscuro tiene que ser
           * claro»). Aquella versión se descartó por otro motivo —el anillo de foco—, pero
           * ESTE segundo bloqueo la barrera ni lo miraba.
           *
           * Hoy no cambia nada: los siete pares modelo×versión del catálogo son de lienzo
           * claro y pasan. Está aquí para el día que alguien vuelva a intentarlo.
           */
          it('el rojo como TEXTO sigue legible sobre el lienzo de esta versión', () => {
            expect(contraste(base.background, base.destructive)).toBeGreaterThanOrEqual(
              AA_TEXTO,
            );
          });

          /**
           * ══ E14 · BARRERA 1 · COHERENCIA DE POLARIDAD ══════════════════════════════
           *
           * Que ninguna superficie de aviso se despegue del lienzo. **No es accesibilidad
           * y por eso está aparte**: una versión oscura que heredara los semánticos claros
           * de su modelo pasaría todas las parejas AA —los avisos se miden entre ellos— y
           * pintaría seis paneles casi blancos sobre un lienzo carbón, a 17,98:1. La norma
           * exige un mínimo, no un máximo; llamar AA a esto sería inventarse una
           * obligación.
           *
           * Hoy no cambia nada: el catálogo va de 1,00 a 1,22 y Contraluz de 1,10 a 1,88.
           * Está puesta ANTES de que exista la versión que la necesita, que es cuando una
           * barrera cuesta cero.
           */
          it('ninguna superficie semántica se despega del lienzo de esta versión', () => {
            expect(coherenciaDePolaridad(base)).toEqual([]);
          });

          /**
           * ══ E14 · BARRERA 2 · COMPLETITUD DE SUPERFICIES (en la base) ══════════════
           *
           * El anillo contra las CUATRO superficies sobre las que puede aparecer, no sólo
           * contra el lienzo. En la base se exige entera y sin excusa: las cuatro salen de
           * la rampa, así que una versión que invierta la luz las invierte todas y no
           * puede quedarse a medias.
           *
           * La que ninguna lista miraba es `muted`. Ver el inventario de más abajo para lo
           * que eso destapó en las zonas.
           */
          it('el anillo cumple 1.4.11 contra las cuatro superficies de la base', () => {
            expect(completitudDeSuperficies(base)).toEqual([]);
          });
        });
      }

      const base = resolverTokens(m, m.coloresPorDefecto);

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

  /**
   * E14 — Y AHORA TAMBIÉN POR VERSIÓN, porque el juego de nombres dejó de depender sólo
   * del modelo.
   *
   * Desde que una versión puede declarar semánticos, una clave mal escrita —`warning-bordre`
   * por `warning-border`— añadiría un token 61 que ningún componente consume, y el
   * verdadero, el que sí se consume, se quedaría con el valor claro heredado. El tema
   * saldría medio girado y nada lo diría: el token sobrante no rompe nada y el que falta
   * tiene un valor perfectamente válido.
   *
   * Es el gemelo exacto de `zonaSoloAjusta` en el otro eje.
   */
  it('cada VERSIÓN declara exactamente los mismos tokens que su modelo', () => {
    const referencia = Object.keys(resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto)).sort();
    for (const m of TODOS_LOS_MODELOS) {
      for (const { id: version } of m.versiones) {
        const suyos = Object.keys(resolverTokens(m, m.coloresPorDefecto, version)).sort();
        const etiqueta = `${m.id}@${version}`;
        expect({ etiqueta, tokens: suyos }).toEqual({ etiqueta, tokens: referencia });
      }
    }
  });
});

/**
 * ══ E14 · EL INVENTARIO DE LA DEUDA: `muted` DENTRO DE UNA ZONA OSCURA ════════════════
 *
 * ── QUÉ SE ENCONTRÓ ────────────────────────────────────────────────────────────────
 *
 * Al medir el anillo contra TODAS las superficies apareció **1,36:1 en la zona `login` del
 * Modelo 0, hoy**. No es un fallo vivo —esa pantalla no pinta un solo `bg-muted`,
 * verificado, sólo `bg-background` y `bg-card`— sino algo peor de encontrar: las cuatro
 * zonas `login` del catálogo redefinen quince tokens y **dejan `muted` en su valor CLARO
 * dentro de un lienzo oscuro**. Ahí no se ve. En una versión oscura, donde `bg-muted`
 * aparece 225 veces en 116 ficheros, se vería en todas.
 *
 * ── POR QUÉ SE INVENTARÍA EN VEZ DE EXIGIRSE ──────────────────────────────────────
 *
 * Porque arreglarlo es tocar el `muted` de cuatro modelos, y eso es un retoque de ASPECTO
 * que se aprueba mirándolo — no cabe en una ráfaga cuyo criterio es no mover un píxel. Y
 * porque tolerarlo en silencio sería peor: mañana nadie recordaría que está.
 *
 * Así que se congela la FORMA de la deuda. Puede pagarse (y entonces hay que acortar esta
 * lista) pero **no puede crecer**: un hueco en otra zona, en otra superficie, o un modelo
 * nuevo que repita la omisión, ponen esto rojo.
 */
describe('E14 · completitud de superficies POR ZONA: la deuda, congelada', () => {
  interface Hueco {
    modelo: string;
    version: string;
    zona: string;
    pareja: string;
  }

  const huecos: Hueco[] = [];
  for (const m of TODOS_LOS_MODELOS) {
    for (const { id: version } of m.versiones) {
      const base = resolverTokens(m, m.coloresPorDefecto, version);
      for (const zona of ESTILO_ZONES) {
        const efectiva = { ...base, ...resolverZona(m, m.coloresPorDefecto, zona, version) };
        for (const f of completitudDeSuperficies(efectiva)) {
          huecos.push({ modelo: m.id, version, zona, pareja: f.pareja });
        }
      }
    }
  }

  /**
   * LA FORMA DE LA DEUDA, y no una lista de siete cadenas: lo que hay que poder afirmar es
   * que **todos los huecos son el mismo hueco** —la superficie atenuada, dentro del login—
   * y no una colección de casos sueltos que nadie ha mirado.
   */
  it('todo hueco es el MISMO hueco: la superficie atenuada dentro de la zona login', () => {
    const distintos = [...new Set(huecos.map((h) => `${h.zona} · ${h.pareja}`))];
    expect(distintos).toEqual(['login · anillo de foco sobre la superficie atenuada']);
  });

  /**
   * Y CUÁNTOS SON. Siete: los siete pares modelo×versión del catálogo, porque los cuatro
   * modelos heredaron la misma omisión de la zona `login` de E5. `MODELO_PRUEBA` no está
   * —es oscuro de fábrica, así que su `muted` ya lo es— y ése es el control negativo del
   * inventario: si esto fuera un artefacto de la medición, Contraluz también aparecería.
   */
  it('son exactamente los siete del catálogo, y Contraluz no está', () => {
    expect(huecos).toHaveLength(7);
    expect(huecos.map((h) => `${h.modelo}@${h.version}`).sort()).toEqual([
      'calido-editorial@dia',
      'calido-editorial@tarde',
      'fresco-confianza@claro',
      'fresco-confianza@nitido',
      'modelo-0@1',
      'premium@claro',
      'premium@claro-intenso',
    ]);
  });
});

/**
 * LA RED DE LAS DOS BARRERAS NUEVAS. Sin esto, las dos pasarían igual de verdes con una
 * lista de superficies vacía o con un umbral que no rechaza nada — que es exactamente cómo
 * una barrera deja de proteger sin que nadie se entere.
 */
describe('E14 · las dos barreras nuevas distinguen lo roto', () => {
  const claro = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);

  it('la coherencia de polaridad caza un semántico claro sobre un lienzo oscuro', () => {
    // Exactamente el defecto: un lienzo carbón con los avisos del Modelo 0 sin girar.
    const mezclado: Tokens = { ...claro, background: '220 24% 8%' };
    const fallos = coherenciaDePolaridad(mezclado);
    expect(fallos.length).toBeGreaterThanOrEqual(6);
    expect(fallos.every((f) => f.ratio > AA_INTERFAZ)).toBe(true);
  });

  it('la completitud caza un anillo que cumple contra el lienzo y no contra la tarjeta', () => {
    // Lienzo oscuro, tarjeta clara y un anillo a medio camino: pasa la pareja de siempre
    // y falla la que E14 añadió. Es la polaridad invertida en miniatura.
    const trampa: Tokens = {
      ...claro,
      background: '0 0% 10%',
      card: '0 0% 90%',
      popover: '0 0% 10%',
      muted: '0 0% 10%',
      ring: '0 0% 65%',
    };
    const fallos = completitudDeSuperficies(trampa);
    // 7,20:1 contra el lienzo —la pareja que ya existía, en verde— y 1,92:1 contra la
    // tarjeta, que es la que sólo E14 mira.
    expect(fallos.map((f) => f.pareja)).toEqual(['anillo de foco sobre la tarjeta']);
    expect(contraste(trampa.background, trampa.ring)).toBeGreaterThan(AA_INTERFAZ);
  });
});
