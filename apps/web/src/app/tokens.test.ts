import * as fs from 'fs';
import * as path from 'path';
import colors from 'tailwindcss/colors';
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
