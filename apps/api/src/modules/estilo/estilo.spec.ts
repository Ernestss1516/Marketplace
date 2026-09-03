import {
  MODELO_0,
  MODELOS,
  resolverTokens,
  validarContraste,
  type ColoresConfigurables,
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
  destructive: '0 84.2% 60.2%',
  'destructive-foreground': '210 40% 98%',
  border: '214.3 31.8% 91.4%',
  input: '214.3 31.8% 91.4%',
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
