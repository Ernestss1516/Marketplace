import * as fs from 'fs';
import * as path from 'path';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Star } from 'lucide-react';
import colors from 'tailwindcss/colors';
import defaultConfig from 'tailwindcss/defaultConfig';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';

/**
 * LA BARRERA DE VALOR DE LOS TOKENS SEMÁNTICOS.
 *
 * Las capturas vigilan lo que se ve; esto vigila lo que NO se ve en ninguna captura.
 * Un token puede migrarse a un valor equivocado en una pantalla que la batería visual
 * no fotografía —un badge de ticket, un aviso que sólo sale sin sesión— y ahí el rojo
 * no llegaría nunca. Aquí sí.
 *
 * SE COMPARA CONTRA `tailwindcss/colors`, NO CONTRA HEXADECIMALES COPIADOS A MANO, y
 * ésa es la diferencia entre una prueba y un comentario: cada token afirma «valgo
 * exactamente lo que valía la clase de escala que sustituí». Si una subida de Tailwind
 * cambiara la paleta, esto lo diría en vez de dejar la equivalencia podrirse en
 * silencio.
 *
 * DOS AFIRMACIONES POR TOKEN, y hacen falta las dos:
 *  1. la variable de `globals.css` vale el color correcto;
 *  2. `tailwind.config.ts` la conecta con su utilidad. Sin lo segundo la clase no
 *     existe, el color sale transparente y ninguna prueba de valor se enteraría.
 */

const globals = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

function valorDe(token: string): string | null {
  const m = globals.match(new RegExp(`--${token}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const tema = resolveConfig(tailwindConfig).theme.colors as unknown as Record<string, unknown>;

function utilidad(nombre: string, clave?: string): unknown {
  const v = tema[nombre];
  if (clave === undefined) return v;
  return (v as Record<string, unknown>)[clave];
}

/**
 * `[token, valor esperado, la clase de escala que sustituye, familia.clave en el tema]`.
 * La tercera columna no la usa la aserción: está para que, cuando esto se ponga rojo,
 * quien lo lea sepa de dónde venía el color sin abrir el historial.
 */
const TOKENS: readonly [string, string, string, string, string?][] = [
  // ── E0 · el aviso de sesión (29 copias) ──────────────────────────────────────
  ['warning', colors.yellow[50], 'bg-yellow-50', 'warning', 'DEFAULT'],
  ['warning-border', colors.yellow[300], 'border-yellow-300', 'warning', 'border'],
  ['warning-foreground', colors.yellow[800], 'text-yellow-800', 'warning', 'foreground'],

  // ── E2 · las convenciones ────────────────────────────────────────────────────
  // No son estados: una estrella dorada y un corazón rojo significan lo que
  // significan en cualquier producto. Ver el porqué en globals.css.
  ['rating', colors.amber[400], 'fill-amber-400 (estrella de valoración)', 'rating'],
  ['featured', colors.amber[400], 'fill-amber-400 (estrella de destacado)', 'featured'],
  ['favorite', colors.red[500], 'fill-red-500 (corazón de favorito)', 'favorite'],

  // ── E2 · el badge de estado ──────────────────────────────────────────────────
  ['warning-strong', colors.yellow[100], 'bg-yellow-100', 'warning', 'strong'],
  ['success-surface', colors.green[100], 'bg-green-100', 'success', 'surface'],
  ['success-foreground', colors.green[800], 'text-green-800', 'success', 'foreground'],
  ['info-surface', colors.blue[100], 'bg-blue-100', 'info', 'surface'],
  ['info-foreground', colors.blue[800], 'text-blue-800', 'info', 'foreground'],
  ['neutral-surface', colors.gray[100], 'bg-gray-100', 'neutral', 'surface'],
  ['neutral-foreground', colors.gray[600], 'text-gray-600', 'neutral', 'foreground'],
];

// Bucle explícito y no `it.each`: las filas tienen 4 o 5 columnas según el token lleve
// o no clave anidada, y `it.each` con longitudes distintas y un título con `%s` se
// vuelve quisquilloso. Un `for` no tiene esa arista y se lee igual de bien.
describe('Cada token semántico vale lo mismo que la clase de escala que sustituyó', () => {
  for (const [token, esperado, origen] of TOKENS) {
    it(`--${token} vale ${esperado}, el color que daba ${origen}`, () => {
      expect(valorDe(token)).toBe(esperado);
    });
  }
});

describe('Tailwind conecta cada token con su utilidad', () => {
  for (const [token, , , familia, clave] of TOKENS) {
    it(`--${token} llega a la utilidad`, () => {
      expect(utilidad(familia, clave)).toBe(`var(--${token})`);
    });
  }
});

/**
 * `--rating` y `--featured` valen lo mismo HOY y son dos tokens a propósito: una
 * valora y la otra vende, y un modelo puede querer separarlas. Esta prueba fija esa
 * decisión — si algún día divergen, el rojo obliga a mirar aquí y confirmar que es
 * intencionado en vez de descubrirlo en una pantalla.
 */
describe('Las dos estrellas', () => {
  it('hoy comparten color, pero son tokens distintos', () => {
    expect(valorDe('rating')).toBe(valorDe('featured'));
    expect(utilidad('rating')).not.toBe(utilidad('featured'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// E3 · LA CAPA T3 — los ejes que no son color
//
// Mismo criterio que arriba: cada eje se compara CONTRA SU ORIGEN, no contra un
// valor copiado a mano. Las sombras y el tempo, contra la configuración por defecto
// de Tailwind, que es de donde salían; el trazo del icono, contra lo que la propia
// lucide pinta. Así, si una subida de cualquiera de las dos cambiara el valor de
// partida, esto lo dice en vez de dejar la equivalencia podrirse.
// ─────────────────────────────────────────────────────────────────────────────────

describe('T3 · Elevación: las sombras valen lo que valían', () => {
  const porDefecto = defaultConfig.theme!.boxShadow as unknown as Record<string, string>;

  for (const [token, clave] of [
    ['shadow-sm', 'sm'],
    ['shadow', 'DEFAULT'],
    ['shadow-md', 'md'],
    ['shadow-lg', 'lg'],
    ['shadow-xl', 'xl'],
  ] as const) {
    it(`--${token} === boxShadow.${clave} de Tailwind`, () => {
      expect(valorDe(token)).toBe(porDefecto[clave]);
    });
  }
});

describe('T3 · Movimiento: el tempo por defecto, ahora con nombre', () => {
  it('--motion-duration es la duración por defecto de Tailwind', () => {
    const d = defaultConfig.theme!.transitionDuration as unknown as Record<string, string>;
    expect(valorDe('motion-duration')).toBe(d.DEFAULT);
  });

  it('--motion-ease es la curva por defecto de Tailwind', () => {
    const e = defaultConfig.theme!.transitionTimingFunction as unknown as Record<string, string>;
    expect(valorDe('motion-ease')).toBe(e.DEFAULT);
  });

  /**
   * E3 NO AÑADE MOVIMIENTO, y esto lo fija. Las dos animaciones escritas a mano del
   * repo —la rotación del titular y el sprite del póster— conservan exactamente su
   * temporización; lo único que cambia es que ahora la leen de un token. Las
   * animaciones de las capas flotantes siguen apagadas desde E0 y vuelven en E6.
   */
  it('las dos animaciones propias conservan su temporización', () => {
    expect(valorDe('motion-ease-emphasis')).toBe('ease-in-out');
    expect(valorDe('motion-sprite-duration')).toBe('1.25s');
  });
});

describe('T3 · Tipografía: la cadena llega hasta Inter', () => {
  /**
   * Se comprueba la CADENA, no un nombre de familia: `next/font` genera el nombre
   * real (`__inter_a1b2c3`) en tiempo de build y no es estable entre compilaciones,
   * así que afirmarlo sería fijar ruido. Lo que sí importa —y lo que se rompería si
   * alguien deshiciera la indirección— es que `--font-sans` apunte a la variable de
   * `next/font` y que los titulares cuelguen de `--font-sans`.
   */
  it('--font-sans toma la familia que declara next/font', () => {
    expect(valorDe('font-sans')).toBe('var(--font-inter)');
  });

  it('--font-heading hereda de --font-sans mientras no haya fuente propia', () => {
    expect(valorDe('font-heading')).toBe('var(--font-sans)');
  });

  it('Tailwind sirve las dos familias', () => {
    const f = resolveConfig(tailwindConfig).theme.fontFamily as unknown as Record<
      string,
      string[]
    >;
    expect(f.sans).toEqual(['var(--font-sans)']);
    expect(f.heading).toEqual(['var(--font-heading)']);
  });
});

describe('T3 · Icono: el trazo es el que lucide pinta', () => {
  /**
   * La comprobación que de verdad vale: se renderiza un icono y se lee el
   * `stroke-width` que lucide le pone. Si `--icon-stroke` dejara de coincidir, los
   * iconos cambiarían de grosor en las 185 pantallas que los usan — y ninguna
   * captura lo detectaría con seguridad, porque un trazo es un puñado de píxeles.
   *
   * El TAMAÑO no está aquí y no es un olvido: los iconos se dimensionan con la
   * escala de espaciado (`h-4 w-4`, 344 veces), que es estructura inviolable.
   */
  it('--icon-stroke coincide con el atributo por defecto de lucide', () => {
    const { container } = render(createElement(Star));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke-width')).toBe(valorDe('icon-stroke'));
  });
});
