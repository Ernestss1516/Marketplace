import {
  ESTILO_ZONES,
  MODELO_0,
  MODELO_CALIDO_EDITORIAL,
  MODELO_PRUEBA,
  MODELOS,
  SEMANTICOS_OSCUROS,
  TODOS_LOS_MODELOS,
  derivarColor,
  idsDeVersion,
  tieneVersion,
  resolverTokens,
  resolverZona,
  validarContraste,
  zonaSoloAjusta,
  type ColoresConfigurables,
  type Modelo,
} from './estilo.constants';
import { contraste, hexATriplete, parsearTriplete } from './color';

/**
 * E4a — LA BARRERA DEL ANDAMIAJE.
 *
 * Las 47 capturas prueban que el sistema no movió un píxel. Esto prueba POR QUÉ no lo
 * movió, que es lo que hace el rojo diagnosticable: si mañana una captura cae, aquí se
 * ve en qué token exacto.
 *
 * Y prueba algo que ninguna captura puede: que la validación de contraste RECHAZA. Un
 * juego de colores inaccesible no llega a ninguna pantalla, así que no hay imagen que
 * lo delate — sólo un test.
 */

/**
 * LOS VALORES QUE HAY HOY EN `globals.css`, transcritos.
 *
 * Sí, es una copia, y es a propósito: el fichero está en `apps/web` y esto corre en
 * `apps/api`, que no lo importa (ni debe). Copiarlo aquí convierte la equivalencia en
 * algo que se puede AFIRMAR: si alguien toca la rampa del Modelo 0, este test cae
 * señalando el token, en vez de dejar el fallo para la corrida de capturas.
 */
const GLOBALS_CSS_HOY: Readonly<Record<string, string>> = {
  background: '0 0% 100%',
  foreground: '222.2 84% 4.9%',
  card: '0 0% 100%',
  'card-foreground': '222.2 84% 4.9%',
  popover: '0 0% 100%',
  'popover-foreground': '222.2 84% 4.9%',
  primary: '221.2 83.2% 53.3%',
  'primary-foreground': '210 40% 98%',
  secondary: '210 40% 96.1%',
  'secondary-foreground': '222.2 47.4% 11.2%',
  muted: '210 40% 96.1%',
  'muted-foreground': '215.4 16.3% 46.9%',
  accent: '210 40% 96.1%',
  'accent-foreground': '222.2 47.4% 11.2%',
  // Cambiado por E6: con el 60,2 % de fábrica, la letra blanca del botón «Eliminar»
  // daba 3,60:1 y el rojo como texto 3,76:1 — los dos por debajo del 4,5:1 que 1.4.3
  // exige a texto. Lo destapó `contraste-modelos.spec.ts`, la barrera que el propio
  // comentario de `parejasBloqueantes` prometía y que no existía.
  destructive: '0 84.2% 47%',
  'destructive-foreground': '210 40% 98%',
  border: '214.3 31.8% 91.4%',
  // Cambiado por la ráfaga del trazo: 1,23:1 no cumplía 1.4.11 en un borde de campo.
  input: '214.3 31.8% 60%',
  ring: '221.2 83.2% 53.3%',
  radius: '0.5rem',
};

describe('Modelo 0 resuelve al estado actual, token por token', () => {
  const tokens = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);

  for (const [nombre, esperado] of Object.entries(GLOBALS_CSS_HOY)) {
    it(`--${nombre} === ${esperado}`, () => {
      expect(tokens[nombre]).toBe(esperado);
    });
  }

  it('no falta ninguno de los tokens que globals.css declara', () => {
    for (const nombre of Object.keys(GLOBALS_CSS_HOY)) {
      expect(tokens[nombre]).toBeDefined();
    }
  });
});

describe('La rampa neutra es una derivación de verdad, no diez constantes', () => {
  /**
   * La prueba de que `--neutral` NO es un token de adorno. Si la rampa fueran valores
   * fijos, girar el neutro no cambiaría nada y este test pasaría por accidente al
   * comparar con `not.toBe`. Así que se comprueba lo que de verdad importa: que el
   * giro se PROPAGA y que la relación entre franjas se conserva.
   */
  const base = MODELO_0.coloresPorDefecto;
  const girado: ColoresConfigurables = { ...base, neutral: '150 40% 96.1%' };

  const a = resolverTokens(MODELO_0, base);
  const b = resolverTokens(MODELO_0, girado);

  it('girar el neutro 60° mueve el tono de todas las franjas cromáticas', () => {
    for (const slot of ['foreground', 'muted-foreground', 'border', 'input']) {
      const ta = parsearTriplete(a[slot])!;
      const tb = parsearTriplete(b[slot])!;
      expect(tb.h - ta.h).toBeCloseTo(-60, 1);
    }
  });

  it('la luz de cada franja NO se mueve: un fondo sigue siendo claro y un texto oscuro', () => {
    for (const slot of ['background', 'foreground', 'muted', 'border']) {
      expect(parsearTriplete(b[slot])!.l).toBe(parsearTriplete(a[slot])!.l);
    }
  });

  it('el fondo se mantiene en gris puro: su saturación no puede irse con el neutro', () => {
    expect(parsearTriplete(b.background)!.s).toBe(0);
  });
});

describe('El admin no elige el color de la letra: lo elige el contraste', () => {
  const [claro, oscuro] = MODELO_0.textoSobre;

  it('sobre el azul de fábrica gana la letra clara', () => {
    const t = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);
    expect(t['primary-foreground']).toBe(claro);
  });

  it('sobre un color principal muy claro gana la letra oscura, sin que nadie lo pida', () => {
    const t = resolverTokens(MODELO_0, {
      ...MODELO_0.coloresPorDefecto,
      primary: '60 90% 90%',
    });
    expect(t['primary-foreground']).toBe(oscuro);
  });
});

/**
 * WCAG 1.4.11 — EL BORDE DE UN CAMPO ES INFORMACIÓN, NO ADORNO.
 *
 * En un formulario cuyo fondo y cuyo campo son el mismo blanco, el contorno es lo
 * ÚNICO que dice dónde se escribe. La norma pide 3:1 para eso, y el valor de fábrica
 * de shadcn daba 1,23:1 — un contorno que quien tiene poca visión sencillamente no ve.
 *
 * Esta pareja nació como aviso en E4a (arreglarla cambiaba píxeles, y aquella ráfaga
 * lo tenía prohibido) y aquí pasa a exigirse. Los tests fijan las dos mitades: que el
 * campo cumple y que el trazo DECORATIVO no está obligado a cumplir.
 */
describe('El borde de campo cumple 1.4.11', () => {
  const t = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);

  it('el borde de campo llega a 3:1 sobre el fondo', () => {
    expect(contraste(t.background, t.input)).toBeGreaterThanOrEqual(3);
  });

  it('y no se pasa de oscuro: Modelo 0 es sobrio', () => {
    // Si alguien lo bajara «por si acaso», esto lo diría. El mínimo redondo que
    // cumple da 3,11:1; cualquier cosa por encima de 4 ya es otra decisión de diseño.
    expect(contraste(t.background, t.input)).toBeLessThan(4);
  });

  it('el trazo DECORATIVO no se toca: la norma no lo exige', () => {
    // La tarjeta se identifica por su contenido, no por su contorno. Subir esto a 3:1
    // sería rediseñar el peso visual de la plataforma entera en nombre de una
    // exigencia que no existe.
    expect(t.border).toBe('214.3 31.8% 91.4%');
    expect(contraste(t.background, t.border)).toBeLessThan(3);
  });

  it('un modelo que deje el campo sin contorno visible YA no se puede guardar', () => {
    // La mutación que mata: devolver el borde de campo a su valor de antes.
    const conCampoInvisible = resolverTokens(
      { ...MODELO_0, rampa: { ...MODELO_0.rampa, input: { dh: 4.3, ds: -8.2, l: 91.4 } } },
      MODELO_0.coloresPorDefecto,
    );
    expect(validarContraste(conCampoInvisible).map((f) => f.pareja)).toContain(
      'borde de campo sobre el fondo',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// E5 · LAS ZONAS
// ─────────────────────────────────────────────────────────────────────────────────────

describe('LA REGLA DURA: una zona ajusta, nunca añade', () => {
  /**
   * Es la barrera que impide que crezca un segundo sistema de estilo. Si el backoffice
   * pudiera declarar `--backoffice-algo`, un modelo tendría que definir dos juegos de
   * valores y media plataforma dejaría de responder a la mitad de los tokens.
   *
   * Un comentario no impide nada; esto sí.
   */
  it('ninguna zona del Modelo 0 inventa un token', () => {
    expect(zonaSoloAjusta(MODELO_0, MODELO_0.coloresPorDefecto)).toEqual([]);
  });

  it('y la comprobación DETECTA al que lo intente', () => {
    const conInvento = {
      ...MODELO_0,
      ajustesPorZona: { backoffice: { 'backoffice-especial': '0 0% 50%' } },
    };
    expect(zonaSoloAjusta(conInvento, MODELO_0.coloresPorDefecto)).toEqual([
      'backoffice:backoffice-especial',
    ]);
  });

  it('el registro público no lleva ajustes: la base ES el público', () => {
    expect(MODELO_0.ajustesPorZona.public).toBeUndefined();
  });

  it('un ajuste que coincide con la base no se emite: sería una regla que no hace nada', () => {
    const igualQueLaBase = {
      ...MODELO_0,
      ajustesPorZona: { cuenta: { background: '0 0% 100%' } },
    };
    expect(resolverZona(igualQueLaBase, MODELO_0.coloresPorDefecto, 'cuenta')).toEqual({});
  });
});

describe('Cada zona sigue siendo accesible después de ajustar', () => {
  /**
   * Una zona puede romper el contraste tan bien como la base: si el backoffice
   * desatura el trazo del campo hasta hacerlo invisible, el formulario deja de tener
   * forma AUNQUE la base cumpla. Así que se valida la paleta EFECTIVA de cada zona,
   * no sólo la de `:root`.
   */
  for (const zona of ESTILO_ZONES) {
    it(`la zona ${zona} cumple AA con los colores de fábrica`, () => {
      const base = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);
      const efectiva = { ...base, ...resolverZona(MODELO_0, MODELO_0.coloresPorDefecto, zona) };
      expect(validarContraste(efectiva)).toEqual([]);
    });
  }
});

describe('La zona login conserva el oscuro que ya tenía', () => {
  const login = resolverZona(MODELO_0, MODELO_0.coloresPorDefecto, 'login');

  /**
   * Los valores son los mismos `slate` que la pantalla llevaba escritos a mano,
   * convertidos a triplete. El viaje hexadecimal → HSL → rgb se comprobó exacto en los
   * ocho tonos ANTES de escribir la zona, así que la pantalla se ve igual: lo que
   * cambia es que ahora responde a un modelo.
   */
  it.each([
    ['background', '#020617', 'slate-950'],
    ['foreground', '#f1f5f9', 'slate-100'],
    ['card', '#0f172a', 'slate-900'],
    ['border', '#1e293b', 'slate-800'],
    ['muted-foreground', '#94a3b8', 'slate-400'],
  ])('--%s sigue siendo %s (%s)', (token, hex) => {
    expect(login[token]).toBe(hexATriplete(hex));
  });

  /**
   * LAS DOS EXCEPCIONES, Y NO SON DESCUIDOS: tematizar esta pantalla destapó que su
   * borde de campo NUNCA cumplió 1.4.11.
   *
   * El `slate-700` que llevaba escrito a mano daba **1,95:1** sobre este lienzo — un
   * contorno que quien tiene poca visión no ve, en la pantalla donde hay que escribir
   * una contraseña. Nadie lo sabía porque nadie lo medía: la validación de contraste
   * sólo miraba la base, y esta pantalla vivía fuera del sistema.
   *
   * Al entrar en él, la regla que la ráfaga del trazo hizo bloqueante se le aplica
   * también. De ahí las dos correcciones:
   *
   *  · el borde de campo sube a `slate-500` (4,24:1);
   *  · el anillo de foco sube a `slate-300`, porque con el borde ya en `slate-500` un
   *    foco del mismo tono no indicaría nada: un indicador que se parece al estado
   *    normal no es un indicador.
   */
  it('el borde de campo YA cumple: subió de slate-700 (1,95:1) a slate-500', () => {
    expect(login.input).toBe(hexATriplete('#64748b'));
    expect(contraste(login.background, login.input)).toBeGreaterThanOrEqual(3);
  });

  it('el foco se distingue del borde en reposo', () => {
    expect(login.ring).toBe(hexATriplete('#cbd5e1'));
    expect(login.ring).not.toBe(login.input);
  });

  it('sigue siendo oscuro: el lienzo es más oscuro que el texto', () => {
    const fondo = parsearTriplete(login.background)!;
    const texto = parsearTriplete(login.foreground)!;
    expect(fondo.l).toBeLessThan(10);
    expect(texto.l).toBeGreaterThan(90);
  });
});

describe('El blog tiñe el lienzo y NADA MÁS', () => {
  const blog = MODELO_0.ajustesPorZona.blog!;

  it('sólo toca superficie y tempo', () => {
    // Si algún día apareciera aquí un token de tipografía o de espaciado, sería una
    // zona reorganizando en vez de revistiendo. La escala tipográfica y la medida de
    // línea son estructura (`prose` fija la segunda), y una zona no las toca.
    expect(Object.keys(blog).sort()).toEqual(
      ['background', 'card', 'motion-duration', 'muted'].sort(),
    );
  });

  it('el lienzo se calienta pero sigue siendo casi blanco: se viene a leer', () => {
    const fondo = parsearTriplete(blog.background)!;
    expect(fondo.l).toBeGreaterThanOrEqual(98);
    expect(fondo.s).toBeGreaterThan(0); // ya no es blanco puro
  });
});

describe('El backoffice RESTA, no añade', () => {
  const base = resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto);
  const bo = MODELO_0.ajustesPorZona.backoffice!;

  it('baja la saturación de los grises sin tocarles el tono ni la luz', () => {
    for (const slot of ['secondary', 'muted', 'accent', 'border']) {
      const antes = parsearTriplete(base[slot])!;
      const ahora = parsearTriplete(bo[slot])!;
      expect(ahora.s).toBeLessThan(antes.s);
      expect(ahora.h).toBe(antes.h);
      expect(ahora.l).toBe(antes.l);
    }
  });

  /**
   * EL BORDE DE CAMPO ES LA EXCEPCIÓN, y la excepción la impuso la aritmética: quitar
   * saturación quita contraste, y con la desaturación del backoffice el trazo se
   * quedaba en 2,96:1 — a cuatro centésimas de incumplir.
   *
   * Así que aquí la resta se compensa oscureciendo dos puntos. No es una licencia: es
   * que la accesibilidad manda sobre la sobriedad cuando chocan, y la validación por
   * zona fue la que lo dijo antes de que llegara a ninguna pantalla.
   */
  it('el borde de campo compensa con luz lo que pierde en saturación', () => {
    const antes = parsearTriplete(base.input)!;
    const ahora = parsearTriplete(bo.input)!;
    expect(ahora.s).toBeLessThan(antes.s);
    expect(ahora.l).toBeLessThan(antes.l);
    expect(contraste(base.background, bo.input)).toBeGreaterThanOrEqual(3);
  });

  it('sube el contraste del texto secundario, que es el que se lee mil veces', () => {
    const efectiva = { ...base, ...bo };
    expect(contraste(efectiva.background, efectiva['muted-foreground'])).toBeGreaterThan(
      contraste(base.background, base['muted-foreground']),
    );
  });

  it('y responde más rápido: una herramienta no se luce', () => {
    expect(parseInt(bo['motion-duration'], 10)).toBeLessThan(
      parseInt(MODELO_0.ejes['motion-duration'], 10),
    );
  });
});

describe('La validación AA rechaza lo que no se puede leer', () => {
  it('los colores de fábrica del Modelo 0 pasan', () => {
    expect(validarContraste(resolverTokens(MODELO_0, MODELO_0.coloresPorDefecto))).toEqual([]);
  });

  /**
   * EL CASO QUE JUSTIFICA TODA LA PIEZA: un gris a media luz como color principal. No
   * es un color absurdo —es exactamente el que alguien elegiría para «un botón
   * discreto»— y con él NINGUNO de los dos colores de letra del modelo llega a 4.5.
   * Aceptar «el menos malo» sería dejar un botón ilegible en producción.
   */
  it('un principal a media luz no llega con ninguna de las dos letras → se rechaza', () => {
    const fallos = validarContraste(
      resolverTokens(MODELO_0, { ...MODELO_0.coloresPorDefecto, primary: '220 10% 50%' }),
    );
    expect(fallos.map((f) => f.pareja)).toContain('letra sobre el color principal');
    expect(fallos[0].ratio).toBeLessThan(4.5);
  });

  /**
   * ESTA PRUEBA AFIRMABA LO CONTRARIO Y ESTABA MAL, y el fallo enseñó algo que merece
   * quedar fijado: **el neutro no puede romper la legibilidad del texto base**, ni
   * queriendo.
   *
   * La primera versión ponía el neutro a media luz esperando un rechazo. No llega:
   * la rampa guarda la luz de cada franja en ABSOLUTO (sólo el tono y la saturación
   * se desplazan con el neutro), así que el fondo sigue en 100 % y el texto en 4.9 %
   * pase lo que pase. Era el diseño funcionando, no un agujero — y por eso el test
   * pasa a comprobar la propiedad de seguridad en vez de un rechazo que no debe
   * ocurrir.
   */
  it('un neutro a media luz NO puede romper el texto base: la luz de la rampa es absoluta', () => {
    const t = resolverTokens(MODELO_0, { ...MODELO_0.coloresPorDefecto, neutral: '210 40% 50%' });
    expect(validarContraste(t)).toEqual([]);
    expect(contraste(t.background, t.foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it('el fallo dice QUÉ pareja y con cuánto, no sólo que no cumple', () => {
    const [f] = validarContraste(
      resolverTokens(MODELO_0, { ...MODELO_0.coloresPorDefecto, primary: '220 10% 50%' }),
    );
    expect(f.pareja).toBeTruthy();
    expect(f.minimo).toBeGreaterThan(0);
    expect(f.ratio).toBeGreaterThan(0);
  });
});

/**
 * EL CONTROL DE ENTRADA DE CUALQUIER MODELO FUTURO.
 *
 * Recorre el catálogo entero, no sólo el Modelo 0: el día que se añada el Modelo 3 con
 * su personalidad, tendrá que demostrar aquí que sus colores de fábrica son accesibles
 * ANTES de poder desplegarse. Es la «capa de contraste en CI» del §10.5 del diseño.
 */
describe('Todo modelo del catálogo es accesible de fábrica', () => {
  for (const m of MODELOS) {
    it(`${m.id} (${m.nombre}) cumple AA con sus colores por defecto`, () => {
      expect(validarContraste(resolverTokens(m, m.coloresPorDefecto))).toEqual([]);
    });

    it(`${m.id} declara al menos una versión`, () => {
      expect(m.versiones.length).toBeGreaterThan(0);
    });

    it(`${m.id} tiene dos colores de letra que cubren claro y oscuro`, () => {
      const [claro, oscuro] = m.textoSobre;
      // Uno tiene que servir sobre negro y el otro sobre blanco, o habrá superficies
      // sin ninguna letra legible.
      expect(contraste('0 0% 0%', claro)).toBeGreaterThanOrEqual(4.5);
      expect(contraste('0 0% 100%', oscuro)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * ══ UNA VERSIÓN NO PUEDE SER UNA ETIQUETA ════════════════════════════════════════════
 *
 * EL DEFECTO QUE ESTO IMPIDE YA OCURRIÓ. `versiones` existía desde E4a y era sólo una
 * cadena: el servicio la validaba al guardar y la devolvía al leer, pero `resolverTokens`
 * **nunca la miraba**. Con un modelo de una sola versión no se notaba; en cuanto
 * `calido-editorial` ofreció Día y Tarde, el desplegable prometía dos ambientes y los dos
 * se veían idénticos. E13 lo arregló añadiendo `porVersion`, y aquí queda la barrera que
 * impide que vuelva a pasar — porque el arreglo de E13 es OPCIONAL por diseño (un modelo
 * sin `porVersion` resuelve igual que antes, que es lo que protege al Modelo 0), y algo
 * opcional es algo que el siguiente modelo puede olvidar.
 *
 * La regla se comprueba sobre el CATÁLOGO, no sobre un modelo concreto: el día que se
 * añada el cuarto con tres versiones, tendrá que demostrar aquí que las tres son distintas
 * antes de poder ofrecerse.
 */
describe('Un modelo que ofrece varias versiones las hace DISTINTAS de verdad', () => {
  const conVarias = MODELOS.filter((m) => m.versiones.length > 1);

  /**
   * EL CONTROL NEGATIVO DEL PROPIO FICHERO. Todo lo de abajo se genera en un bucle sobre
   * `conVarias`; si esa lista se quedara vacía —porque alguien retirase los modelos de dos
   * versiones—, el `describe` pasaría en verde sin comprobar absolutamente nada.
   */
  it('hay al menos un modelo con más de una versión, o esto no mide nada', () => {
    expect(conVarias.length).toBeGreaterThan(0);
  });

  for (const m of conVarias) {
    it(`${m.id}: no hay dos versiones que resuelvan al MISMO tema`, () => {
      const huellas = m.versiones.map(({ id: v }) =>
        JSON.stringify(resolverTokens(m, m.coloresPorDefecto, v)),
      );
      // Un `Set` con menos elementos que versiones significa que al menos dos son la
      // misma paleta con dos nombres — exactamente el defecto de antes de E13.
      expect(new Set(huellas).size).toBe(m.versiones.length);
    });
  }

  /**
   * Y ADEMÁS, QUE LA DIFERENCIA SE VEA. Lo de arriba se contentaría con que dos versiones
   * difirieran en una sombra; eso es cierto y no es lo que el desplegable promete. Estos
   * dos modelos anuncian AMBIENTES —«Día/Tarde», «Claro/Nítido»—, y un ambiente se nota en
   * el lienzo, en el texto y en el trazo o no se nota en absoluto.
   *
   * Se escribe por modelo y no en el bucle a propósito: es una promesa de ESTOS dos, no
   * una regla del sistema. Un modelo futuro puede ofrecer versiones que sólo cambien el
   * tempo, y eso sería legítimo — lo que no es legítimo es llamarlas como éstas.
   */
  it.each([
    ['calido-editorial', 'dia', 'tarde'],
    ['fresco-confianza', 'claro', 'nitido'],
    ['premium', 'claro', 'claro-intenso'],
  ])('%s: entre «%s» y «%s» cambian lienzo, texto y trazo', (id, a, b) => {
    const m = MODELOS.find((x) => x.id === id)!;
    const uno = resolverTokens(m, m.coloresPorDefecto, a);
    const otro = resolverTokens(m, m.coloresPorDefecto, b);

    expect(uno.background).not.toBe(otro.background);
    expect(uno.foreground).not.toBe(otro.foreground);
    expect(uno.border).not.toBe(otro.border);
  });
});

describe('La conversión de lo que el admin escribe', () => {
  it('un hexadecimal se normaliza al triplete de globals.css', () => {
    // #2563eb es el azul de hoy: la ida y vuelta tiene que caer donde estaba.
    expect(hexATriplete('#2563eb')).toBe('221.2 83.2% 53.3%');
  });

  it('rechaza lo que no es un color', () => {
    expect(hexATriplete('azul')).toBeNull();
    expect(parsearTriplete('221.2 83.2 53.3')).toBeNull();
    expect(parsearTriplete('221.2 300% 53.3%')).toBeNull();
  });
});

/**
 * ══ E14 · LA VERSIÓN DERIVA ══════════════════════════════════════════════════════════
 *
 * `AjustesDeVersion` pasó de dos campos a cinco: `foco`, `semanticos` y `ajustesPorZona`
 * se suman a la rampa y a los ejes. Lo que se prueba aquí es la frontera hecha código
 * —**el modelo ELIGE, la versión DERIVA**— y, antes que nada, que ampliarla no movió nada.
 */

/** Un modelo de laboratorio: el Modelo 0 con una versión que sí usa los campos nuevos. */
function conVersion(ajustes: Record<string, unknown>): Modelo {
  return {
    ...MODELO_0,
    versiones: [
      { id: '1', nombre: 'Original' },
      { id: 'lab', nombre: 'Laboratorio' },
    ],
    porVersion: { '1': {}, lab: ajustes },
  } as Modelo;
}

describe('E14 · QUIÉN USA LOS CAMPOS NUEVOS, Y QUÉ LES PASA A LOS DEMÁS', () => {
  /**
   * ⚠ EL INVENTARIO DE CONSUMIDORES. ES LA PRIMERA BARRERA QUE HAY QUE MIRAR SI ALGO SE
   * MUEVE EN LAS CAPTURAS.
   *
   * En E14-A este test decía «nadie los usa», y su comentario anunciaba que la ráfaga B lo
   * pondría rojo a propósito. **Ése era el punto**: usar un campo nuevo cambia cómo se ve
   * una versión, así que no puede ocurrir de refilón dentro de una ráfaga que fuera a
   * regenerar capturas sin mirarlas.
   *
   * Ahora que hay consumidores, la barrera cambia de forma pero no de propósito: se congela
   * **quién usa qué**. Estrenar un campo en una versión más sigue siendo un acto
   * deliberado, con su rojo y su línea que actualizar.
   *
   * Las tres entradas de Premium, y por qué cada una:
   *
   *  · `claro` y `claro-intenso` declaran `ajustesPorZona` para UNA zona, el `login`: son
   *    versiones claras, así que su puerta de servicio oscura tiene que invertir el anillo,
   *    el botón y el trío del error. Esos seis tokens vivían en el modelo y se mudaron aquí
   *    en B2 — ver `PREMIUM_LOGIN_INVERTIDO`. **No cambian ni un valor resuelto**, y el test
   *    de más abajo lo exige;
   *  · `oscuro` usa los cinco campos. Es la versión que motivó E14 entero.
   */
  it('sólo las versiones del inventario usan los campos nuevos', () => {
    const usan: string[] = [];
    for (const m of MODELOS) {
      for (const [version, ajustes] of Object.entries(m.porVersion ?? {})) {
        for (const campo of ['foco', 'semanticos', 'ajustesPorZona'] as const) {
          if (ajustes[campo] !== undefined) usan.push(`${m.id}@${version}.${campo}`);
        }
      }
    }
    expect(usan.sort()).toEqual([
      'premium@claro-intenso.ajustesPorZona',
      'premium@claro.ajustesPorZona',
      'premium@oscuro.ajustesPorZona',
      'premium@oscuro.foco',
      'premium@oscuro.semanticos',
    ]);
  });

  /**
   * Y QUE A QUIEN NO LOS USA NO LE PASE NADA. Éstas son las dos superficies que E14 puede
   * mover: el anillo (que ahora puede derivarse) y los semánticos (que ahora pueden
   * mezclarse). Para una versión que no declara `foco` ni `semanticos`, el resultado tiene
   * que ser el de antes de E14 — byte a byte, por el camino corto.
   *
   * Se calcula quién entra en vez de escribirlo: el día que otra versión estrene un campo,
   * sale sola de esta lista y entra en la de arriba, que es donde se mira.
   */
  const sinDerivar = MODELOS.flatMap((m) =>
    m.versiones
      .filter((v) => {
        const a = m.porVersion?.[v.id];
        return a?.foco === undefined && a?.semanticos === undefined;
      })
      .map((v) => [m.id, v.id] as const),
  );

  it('hay versiones que no derivan, o lo de abajo no mide nada', () => {
    expect(sinDerivar.length).toBeGreaterThanOrEqual(7);
  });

  it.each(sinDerivar)(
    '%s@%s: el anillo sigue siendo el primario LITERAL y los semánticos, los del modelo',
    (id, version) => {
      const m = MODELOS.find((x) => x.id === id)!;
      const t = resolverTokens(m, m.coloresPorDefecto, version);

      expect(t.ring).toBe(m.coloresPorDefecto.primary);
      for (const [nombre, valor] of Object.entries(m.semanticos)) {
        expect({ nombre, valor: t[nombre] }).toEqual({ nombre, valor });
      }
    },
  );
});

/**
 * ══ E14-B2 · «OSCURO», LA PRIMERA VERSIÓN DE LIENZO INVERTIDO ════════════════════════
 *
 * Lo que AA y las dos barreras de E14-A miden ya está cubierto en
 * `contraste-modelos.spec.ts`, que recorre las tres versiones de Premium por las cinco
 * zonas. Aquí van las afirmaciones que ninguna medición de contraste puede hacer: que la
 * mudanza del `login` no movió a las versiones claras, y que la decisión D4 se cumple.
 */
describe('E14-B2 · premium@oscuro', () => {
  const PREMIUM = MODELOS.find((m) => m.id === 'premium')!;
  const COLORES = PREMIUM.coloresPorDefecto;

  /** El tema completo de una versión: la base y sus cinco zonas. */
  const temaDe = (version: string) => ({
    base: resolverTokens(PREMIUM, COLORES, version),
    zonas: Object.fromEntries(
      ESTILO_ZONES.map((z) => [z, resolverZona(PREMIUM, COLORES, z, version)]),
    ),
  });

  it('el catálogo la ofrece, y con su nombre', () => {
    expect(PREMIUM.versiones.map((v) => v.id)).toEqual(['claro', 'claro-intenso', 'oscuro']);
    expect(PREMIUM.versiones.find((v) => v.id === 'oscuro')?.nombre).toBe('Oscuro');
  });

  it('invierte la luz de verdad: lienzo oscuro, texto claro', () => {
    const { base } = temaDe('oscuro');
    const claro = resolverTokens(PREMIUM, COLORES, 'claro');
    // El lienzo de una y el de la otra están en mitades opuestas de la escala.
    expect(contraste(claro.background, base.background)).toBeGreaterThanOrEqual(10);
    expect(contraste(claro.foreground, base.foreground)).toBeGreaterThanOrEqual(10);
  });

  /**
   * ⚠ EL ANILLO ES DERIVADO, NO UN LITERAL — y es el bloqueo que descartó esta versión
   * cuando se pidió: el marino de marca sobre el carbón daba 1,85:1.
   *
   * Lo que se afirma no es el valor (eso lo mide la barrera de contraste) sino que **sigue
   * girando con el color del admin**. Un literal pasaría la primera mitad y no la segunda.
   */
  it('el anillo se deriva del primario del admin, y le sigue', () => {
    const { base } = temaDe('oscuro');
    expect(base.ring).toBe('220 45% 70%');

    const otroPrimario = { ...COLORES, primary: '10 70% 40%' };
    expect(resolverTokens(PREMIUM, otroPrimario, 'oscuro').ring).toBe('10 70% 80%');
  });

  it('los semánticos están girados: el rojo es claro y se lee sobre el carbón', () => {
    const { base } = temaDe('oscuro');
    expect(base.destructive).toBe(SEMANTICOS_OSCUROS.destructive);
    expect(contraste(base.background, base.destructive)).toBeGreaterThanOrEqual(4.5);
    // Y las tres convenciones NO se giran: siguen siendo las del modelo.
    for (const convencion of ['rating', 'featured', 'favorite']) {
      expect(base[convencion]).toBe(PREMIUM.semanticos[convencion]);
    }
  });

  /**
   * ⚠ LA DECISIÓN D4, HECHA AFIRMACIÓN.
   *
   * En los modelos claros la zona `login` existe para que la puerta de servicio se distinga
   * de un vistazo: es la única pantalla oscura. En una plataforma ya oscura esa distinción
   * no tiene con qué hacerse, y forzarla sería inventar una diferencia sin significado.
   *
   * «Oscuro» acepta que el login se funda con el resto, y eso se ve en que **la zona no
   * emite ni una declaración**. No es casualidad ni omisión: la rampa se moldeó sobre el
   * lienzo de esa zona, así que los nueve tokens del modelo coinciden con la base y
   * `resolverZona` los descarta; el décimo lo alinea la versión a mano.
   *
   * MUTACIÓN: devolver los seis escapes al bloque del modelo deja esto rojo al instante —
   * el login volvería a tener anillo de bronce y botón claro él solo.
   */
  it('D4 — la zona login no se distingue por color: no emite NADA', () => {
    expect(resolverZona(PREMIUM, COLORES, 'login', 'oscuro')).toEqual({});
  });

  /**
   * ⚠ Y LAS TRES ZONAS QUE SÍ INVIERTE DECLARAN EL BLOQUE COMPLETO (decisión D2).
   *
   * La mezcla es por token sobre el bloque del modelo, y el del modelo es CLARO. Dejar un
   * token fuera sería una losa blanca dentro de un tema oscuro — el modo de fallo que la
   * auditoría midió en 1,06:1. La barrera de contraste lo cazaría; esto lo dice antes y con
   * el nombre del token delante.
   */
  it.each(['backoffice', 'blog', 'cuenta'] as const)(
    'D2 — la zona %s declara todos los tokens que el modelo declara para ella',
    (zona) => {
      const delModelo = Object.keys(PREMIUM.ajustesPorZona[zona] ?? {}).sort();
      const deLaVersion = Object.keys(
        PREMIUM.porVersion?.oscuro?.ajustesPorZona?.[zona] ?? {},
      ).sort();
      expect(deLaVersion).toEqual(delModelo);
    },
  );

  /**
   * ⚠ LA MUDANZA DEL `login` NO MOVIÓ A LAS VERSIONES CLARAS.
   *
   * B2 sacó seis tokens del bloque `login` del modelo y los puso en las dos versiones
   * claras, porque sólo hacen falta cuando el tema base es claro. La mezcla por token
   * produce el mismo resultado — y «produce el mismo resultado» es exactamente la clase de
   * afirmación que hay que medir en vez de razonar, porque si fallara se vería en una
   * captura del login y no en el sitio donde se cambió.
   */
  it.each(['claro', 'claro-intenso'] as const)(
    '%s resuelve la zona login con los mismos quince tokens de siempre',
    (version) => {
      expect(resolverZona(PREMIUM, COLORES, 'login', version)).toEqual({
        background: '220 24% 8%',
        foreground: '220 16% 95%',
        card: '220 20% 13%',
        'card-foreground': '220 16% 95%',
        popover: '220 20% 13%',
        'popover-foreground': '220 16% 95%',
        border: '220 14% 24%',
        input: '220 10% 52%',
        'muted-foreground': '220 12% 70%',
        ring: '42 62% 62%',
        primary: '220 16% 95%',
        'primary-foreground': '220 20% 13%',
        'destructive-subtle': '#3d0d0d',
        'destructive-border': '#7f1d1d',
        'destructive-strong': '#fca5a5',
      });
    },
  );
});

describe('E14 · EL FOCO SE DERIVA, y por eso sigue girando con el primario', () => {
  const OSCURO = conVersion({ foco: { dl: 40 } });

  it('sin `foco`, el anillo es la copia literal de siempre', () => {
    const t = resolverTokens(OSCURO, MODELO_0.coloresPorDefecto, '1');
    expect(t.ring).toBe(MODELO_0.coloresPorDefecto.primary);
  });

  it('con `foco`, el anillo es el primario desplazado', () => {
    const t = resolverTokens(OSCURO, MODELO_0.coloresPorDefecto, 'lab');
    // 221.2 83.2% 53.3% + 40 puntos de luz.
    expect(t.ring).toBe('221.2 83.2% 93.3%');
  });

  /**
   * ⚠ LA PROPIEDAD QUE JUSTIFICA QUE SEA UNA DERIVACIÓN Y NO UN LITERAL.
   *
   * Una zona `login` sí puede fijar `ring` a un color: afecta a UNA pantalla. Una versión
   * afecta a las 81, y ahí un literal rompería la promesa del sistema en silencio — el
   * admin cambiaría su primario y el foco se quedaría donde estaba.
   *
   * MUTACIÓN: sustituir la derivación por un literal deja verde el test de arriba y pone
   * ROJO éste, que es exactamente el reparto que se buscaba.
   */
  it('si el admin cambia su primario, el anillo se va con él', () => {
    const otros: ColoresConfigurables = { ...MODELO_0.coloresPorDefecto, primary: '10 70% 40%' };
    const t = resolverTokens(OSCURO, otros, 'lab');

    expect(t.ring).toBe('10 70% 80%');
    expect(t.ring).not.toBe(resolverTokens(OSCURO, MODELO_0.coloresPorDefecto, 'lab').ring);
  });

  it('un color ilegible se devuelve tal cual en vez de inventarse uno', () => {
    expect(derivarColor('morado', { dl: 40 })).toBe('morado');
  });
});

describe('E14 · LOS SEMÁNTICOS DE UNA VERSIÓN se mezclan PARCIALMENTE', () => {
  const TARDE = conVersion({ semanticos: { destructive: '0 84.2% 46%' } });

  it('lo que la versión nombra, cambia', () => {
    const t = resolverTokens(TARDE, MODELO_0.coloresPorDefecto, 'lab');
    expect(t.destructive).toBe('0 84.2% 46%');
  });

  it('lo que no nombra —los otros 29— lo hereda del modelo', () => {
    const t = resolverTokens(TARDE, MODELO_0.coloresPorDefecto, 'lab');
    const heredados = Object.entries(MODELO_0.semanticos).filter(([n]) => n !== 'destructive');
    expect(heredados).toHaveLength(29);
    for (const [nombre, valor] of heredados) {
      expect({ nombre, valor: t[nombre] }).toEqual({ nombre, valor });
    }
  });

  /**
   * EL CASO REAL QUE ESTO DESBLOQUEA, dejado escrito porque es la razón de que el campo
   * exista: el rojo del Modelo 0 (47 % de luz) da 4,446:1 sobre el lienzo de «Tarde» y
   * falla 1.4.3 por cinco centésimas. Sin este campo la corrección tuvo que aplicarse AL
   * MODELO —y se la comió «Día», que no la necesitaba—. Con él, cada versión lleva el suyo.
   */
  it('un lienzo más oscuro puede llevar su propio rojo sin arrastrar a su hermana', () => {
    const claro = resolverTokens(TARDE, MODELO_0.coloresPorDefecto, '1');
    const tarde = resolverTokens(TARDE, MODELO_0.coloresPorDefecto, 'lab');
    expect(claro.destructive).toBe('0 84.2% 47%');
    expect(tarde.destructive).toBe('0 84.2% 46%');
  });
});

describe('E14 · LAS ZONAS DE UNA VERSIÓN se mezclan POR TOKEN', () => {
  const OSCURA = conVersion({
    ajustesPorZona: { backoffice: { background: '222.2 84% 6%' } },
  });

  it('el token que la versión nombra sustituye al del modelo', () => {
    const z = resolverZona(OSCURA, MODELO_0.coloresPorDefecto, 'backoffice', 'lab');
    expect(z.background).toBe('222.2 84% 6%');
  });

  it('los demás tokens de esa zona siguen siendo los del modelo', () => {
    const z = resolverZona(OSCURA, MODELO_0.coloresPorDefecto, 'backoffice', 'lab');
    // El backoffice del Modelo 0 resta saturación y baja el tempo; eso no lo toca la versión.
    expect(z.muted).toBe(MODELO_0.ajustesPorZona.backoffice?.muted);
    expect(z['motion-duration']).toBe('100ms');
  });

  it('las zonas que la versión no nombra quedan intactas', () => {
    const blog = resolverZona(OSCURA, MODELO_0.coloresPorDefecto, 'blog', 'lab');
    expect(blog).toEqual(resolverZona(MODELO_0, MODELO_0.coloresPorDefecto, 'blog'));
  });

  /**
   * LA REGLA DURA LLEGA TAMBIÉN AL ESCAPE NUEVO. Sin esto, las zonas de una versión serían
   * el único sitio del sistema donde se puede inventar un token — y así es como se cuela un
   * segundo sistema de estilo: por la puerta recién abierta, mientras todo el mundo vigila
   * la vieja.
   */
  it('una zona de versión tampoco puede inventar un token', () => {
    const inventora = conVersion({
      ajustesPorZona: { backoffice: { 'backoffice-algo': '0 0% 50%' } },
    });
    expect(zonaSoloAjusta(inventora, MODELO_0.coloresPorDefecto)).toEqual([
      'lab/backoffice:backoffice-algo',
    ]);
  });
});

/**
 * ══ E14 · EL MOLDE OSCURO, EXTRAÍDO Y NO INVENTADO ═══════════════════════════════════
 *
 * `SEMANTICOS_OSCUROS` son los de `MODELO_PRUEBA` sacados a una constante para que una
 * versión oscura los esparza. De una extracción hay que demostrar dos cosas: que no cambió
 * lo que había, y que lo que salió tiene la forma que se prometió.
 */
describe('E14 · SEMANTICOS_OSCUROS', () => {
  /**
   * LOS 30 DE CONTRALUZ, TRANSCRITOS DE ANTES DE LA EXTRACCIÓN.
   *
   * Es una copia deliberada, igual que `GLOBALS_CSS_HOY` de arriba y por el mismo motivo:
   * convierte «no cambió nada» en algo que se puede AFIRMAR. Y aquí importa más que en
   * ningún otro modelo — `MODELO_PRUEBA` es contra el que compara el test de invariancia
   * del HTML, así que moverlo invalidaría esa comparación sin que nada lo dijera.
   */
  const CONTRALUZ_ANTES: Readonly<Record<string, string>> = {
    destructive: '0 85% 68%',
    'destructive-foreground': '30 50% 8%',
    warning: '#2a1f04',
    'warning-surface': '#3d2d05',
    'warning-border': '#a16207',
    'warning-foreground': '#fde68a',
    'warning-solid': '#f59e0b',
    'warning-solid-hover': '#fbbf24',
    success: '#052e16',
    'success-surface': '#064e3b',
    'success-border': '#15803d',
    'success-foreground': '#a7f3d0',
    'success-solid': '#10b981',
    'success-solid-hover': '#34d399',
    info: '#0b1e3a',
    'info-surface': '#12305c',
    'info-border': '#1d4ed8',
    'info-foreground': '#bfdbfe',
    'destructive-subtle': '#3f0a0a',
    'destructive-border': '#991b1b',
    'destructive-strong': '#fca5a5',
    'pending-surface': '#3b0764',
    'pending-foreground': '#e9d5ff',
    'neutral-surface': '#292524',
    'neutral-foreground': '#d6d3d1',
    'neutral-solid': '#a8a29e',
    'neutral-solid-hover': '#d6d3d1',
    rating: '#fbbf24',
    featured: '#fb923c',
    favorite: '#fb7185',
  };

  it('Contraluz resuelve EXACTAMENTE lo que resolvía antes de extraer el molde', () => {
    expect({ ...MODELO_PRUEBA.semanticos }).toEqual(CONTRALUZ_ANTES);
  });

  /**
   * LA DECISIÓN D1, HECHA ESTRUCTURA. Un molde que trajera las tres convenciones haría que
   * toda versión oscura las tiñese sin querer — y el color de una estrella de valoración o
   * de un corazón de favorito es parte del SIGNIFICADO, no del ambiente (la distinción es
   * de E2). Que no estén es lo que hace que una versión que esparza esto se quede con las
   * del modelo **sin tener que acordarse**.
   */
  it('trae los 27 de ESTADO y ninguna de las 3 convenciones', () => {
    expect(Object.keys(SEMANTICOS_OSCUROS)).toHaveLength(27);
    for (const convencion of ['rating', 'featured', 'favorite']) {
      expect(SEMANTICOS_OSCUROS).not.toHaveProperty(convencion);
    }
  });

  it('cubre exactamente los mismos nombres de estado que el Modelo 0', () => {
    const estadosDelModelo0 = Object.keys(MODELO_0.semanticos)
      .filter((n) => !['rating', 'featured', 'favorite'].includes(n))
      .sort();
    expect(Object.keys(SEMANTICOS_OSCUROS).sort()).toEqual(estadosDelModelo0);
  });

  /**
   * QUE EL MOLDE FUNCIONE FUERA DE SU CASA, que es lo que separa un molde de una copia.
   * Sobre un lienzo carbón cualquiera el rojo tiene que leerse como TEXTO — la pareja que
   * se queda en 3,70:1 cuando una versión oscura hereda los semánticos claros de su modelo.
   */
  it('sobre un lienzo carbón ajeno, el rojo sigue legible como texto', () => {
    expect(contraste('220 24% 8%', SEMANTICOS_OSCUROS.destructive)).toBeGreaterThanOrEqual(4.5);
    expect(contraste('220 24% 8%', MODELO_0.semanticos.destructive)).toBeLessThan(4.5);
  });
});

/**
 * ══ E14-B1 · CADA VERSIÓN TIENE NOMBRE, Y EL NOMBRE NO ES EL DATO ════════════════════
 *
 * El desplegable de `/admin/estilo` pintaba el identificador: «dia», «nitido»,
 * «claro-intenso». Ahora pinta el nombre. Lo que hay que sostener son dos cosas que se
 * rompen de formas distintas: que **ninguna versión se quede sin nombre** (y entonces
 * alguien escribiría el identificador otra vez, esta vez a mano) y que **el nombre no
 * llegue nunca al tema ni a la base**.
 */
describe('E14-B1 · los nombres visibles de las versiones', () => {
  const todas = TODOS_LOS_MODELOS.flatMap((m) =>
    m.versiones.map((v) => ({ modelo: m.id, ...v })),
  );

  it('hay versiones que mirar (red del propio test)', () => {
    expect(todas.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * ⚠ QUE EL NOMBRE SEA UN NOMBRE, Y NO EL IDENTIFICADOR DISFRAZADO.
   *
   * El tipo ya obliga a declarar `nombre` —una versión sin él no compila—, así que la
   * mitad de esta barrera es estructural. Lo que el tipo NO puede impedir es
   * `{ id: 'claro-intenso', nombre: 'claro-intenso' }`, que compila, se pinta igual de
   * feo y deja el defecto exactamente donde estaba.
   *
   * Un identificador de este registro es kebab-case y en minúscula; un nombre en español
   * empieza por mayúscula y no lleva guiones. Afirmarlo es lo que convierte «se le puso
   * nombre» en algo comprobable.
   */
  it.each(todas.map((v) => [`${v.modelo}@${v.id}`, v.id, v.nombre]))(
    '%s — su nombre es un nombre, no el identificador',
    (_etiqueta, id, nombre) => {
      expect(nombre).not.toBe(id);
      expect(nombre.trim()).toBe(nombre);
      expect(nombre.length).toBeGreaterThan(0);
      // Mayúscula inicial y sin la puntuación de un identificador.
      expect(nombre[0]).toBe(nombre[0].toUpperCase());
      expect(nombre).not.toMatch(/[-_]/);
    },
  );

  /** Dentro de un modelo, dos versiones no pueden llamarse igual: el admin elige a ciegas. */
  it.each(TODOS_LOS_MODELOS.map((m) => [m.id, m] as const))(
    '%s — sus versiones tienen identificadores y nombres únicos',
    (_id, m) => {
      expect(new Set(idsDeVersion(m)).size).toBe(m.versiones.length);
      expect(new Set(m.versiones.map((v) => v.nombre)).size).toBe(m.versiones.length);
    },
  );

  /**
   * ⚠ EL NOMBRE ES PRESENTACIÓN: NO PUEDE TOCAR UN SOLO TOKEN.
   *
   * Es la barrera del cambio nulo de esta ráfaga, y se afirma en vez de suponerse porque
   * la forma de `versiones` cambió: si alguien conectara el nombre a la resolución —un
   * `porVersion[nombre]` en vez de `porVersion[id]`, que es el error natural— el tema de
   * los siete pares del catálogo se movería y las capturas lo dirían tarde.
   *
   * MUTACIÓN: resolver por nombre en vez de por identificador pone esto rojo al instante.
   */
  it('renombrar una versión no mueve ni un token', () => {
    const renombrado: Modelo = {
      ...MODELO_CALIDO_EDITORIAL,
      versiones: MODELO_CALIDO_EDITORIAL.versiones.map((v) => ({
        ...v,
        nombre: `${v.nombre} (otro nombre)`,
      })),
    };
    for (const { id } of MODELO_CALIDO_EDITORIAL.versiones) {
      expect(resolverTokens(renombrado, MODELO_CALIDO_EDITORIAL.coloresPorDefecto, id)).toEqual(
        resolverTokens(
          MODELO_CALIDO_EDITORIAL,
          MODELO_CALIDO_EDITORIAL.coloresPorDefecto,
          id,
        ),
      );
    }
  });

  /**
   * Y QUE LO QUE SE GUARDA SIGA SIENDO EL IDENTIFICADOR. `tieneVersion` es la puerta por
   * la que pasa el PUT antes de escribir en `Setting`; si aceptara el nombre, una
   * configuración guardada dejaría de resolver el día que alguien corrigiera una tilde.
   */
  it('una versión se reconoce por su identificador, nunca por su nombre', () => {
    expect(tieneVersion(MODELO_CALIDO_EDITORIAL, 'dia')).toBe(true);
    expect(tieneVersion(MODELO_CALIDO_EDITORIAL, 'Día')).toBe(false);
    expect(idsDeVersion(MODELO_CALIDO_EDITORIAL)).toEqual(['dia', 'tarde']);
  });
});
