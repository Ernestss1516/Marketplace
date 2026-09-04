/**
 * E4a — COLOR: PARSEO, DERIVACIÓN Y CONTRASTE. Fichero PURO, sin DI y sin Nest.
 *
 * Vive separado del servicio por el mismo motivo que `branding.constants.ts`: lo usan
 * el servicio (que valida antes de guardar) y la batería de pruebas (que comprueba
 * los ratios de cada modelo sin montar un módulo). Y porque es aritmética: se prueba
 * con números, no con peticiones.
 *
 * ── EL FORMATO: TRIPLETE HSL, NO HEXADECIMAL ──────────────────────────────────────
 *
 * Los colores se guardan y se emiten como `"221.2 83.2% 53.3%"`, sin `hsl()`. No es
 * capricho: es EXACTAMENTE el formato que `globals.css` usa desde que shadcn montó
 * los diecisiete tokens, porque Tailwind los consume como `hsl(var(--primary))` y ese
 * envoltorio es lo que permite el modificador de opacidad (`bg-primary/90`, que los
 * botones usan).
 *
 * La consecuencia importante para E4a es de precisión: **el Modelo 0 copia los
 * tripletes literalmente de `globals.css`**, así que no hay ninguna conversión de ida
 * y vuelta que pueda mover un canal por redondeo. El admin sí introducirá
 * hexadecimales (un selector de color no habla HSL), y ahí la conversión ocurre una
 * vez, al guardar, sobre un valor que el usuario acaba de elegir — no sobre uno que
 * ya estaba bien.
 */

/** Un color en el formato de `globals.css`: `"H S% L%"`. */
export type TripleteHsl = string;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `"221.2 83.2% 53.3%"` → `{ h: 221.2, s: 83.2, l: 53.3 }`. `null` si no es válido. */
export function parsearTriplete(v: string): { h: number; s: number; l: number } | null {
  const m = /^\s*(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/.exec(v);
  if (!m) return null;
  const [h, s, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![h, s, l].every(Number.isFinite)) return null;
  if (s < 0 || s > 100 || l < 0 || l > 100) return null;
  return { h, s, l };
}

/** Redondea a un decimal, que es la precisión con la que `globals.css` está escrito. */
function unDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatearTriplete(h: number, s: number, l: number): TripleteHsl {
  const hh = ((h % 360) + 360) % 360;
  return `${unDecimal(hh)} ${unDecimal(Math.min(100, Math.max(0, s)))}% ${unDecimal(
    Math.min(100, Math.max(0, l)),
  )}%`;
}

/** HSL → RGB (0-255). Algoritmo estándar; sólo se usa para medir contraste. */
export function hslARgb(h: number, s: number, l: number): Rgb {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(f(0) * 255),
    g: Math.round(f(8) * 255),
    b: Math.round(f(4) * 255),
  };
}

/** `#rrggbb` → triplete HSL. Lo que el admin introduce se normaliza aquí, una vez. */
export function hexATriplete(hex: string): TripleteHsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return formatearTriplete(h, s * 100, l * 100);
}

/**
 * Luminancia relativa según WCAG 2.1 (§ definición de «relative luminance»).
 * Se implementa a mano y no con una dependencia porque son ocho líneas de aritmética
 * y añadir un paquete para esto sería añadir una superficie de actualización a cambio
 * de nada.
 */
export function luminancia({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * Un color, venga como venga: triplete HSL o hexadecimal.
 *
 * ── POR QUÉ HIZO FALTA (E6) ──────────────────────────────────────────────────────────
 *
 * Los tokens del sistema conviven en dos notaciones y siempre lo han hecho: la rampa y
 * los colores de marca son TRIPLETES —porque `hsl(var(--x) / 0.5)` necesita las tres
 * componentes sueltas para poder llevar opacidad—, mientras que los SEMÁNTICOS son
 * HEXADECIMALES, copiados tal cual de las utilidades de Tailwind que sustituyeron.
 *
 * `contraste()` sólo sabía leer lo primero y devolvía **0** para lo segundo. Eso no
 * rompía nada visible, porque las parejas bloqueantes son todas de la rampa… y explica
 * por qué los semánticos NUNCA se habían medido: la herramienta no podía leerlos. Se vio
 * al escribir `contraste-modelos.spec.ts`, cuando las diez parejas de aviso, éxito, error
 * y pendiente salieron con ratio 0 — no ilegibles: **inmedibles**.
 *
 * Aceptar las dos notaciones es estrictamente más capaz y no puede cambiar ningún
 * veredicto anterior: donde antes salía 0 (y por tanto «no cumple»), ahora sale el número
 * real.
 */
export function aTriplete(v: string): TripleteHsl | null {
  const directo = parsearTriplete(v);
  if (directo) return v;
  return hexATriplete(v);
}

/** Ratio de contraste WCAG entre dos colores. Va de 1 (idénticos) a 21 (blanco/negro). */
export function contraste(a: TripleteHsl, b: TripleteHsl): number {
  const ta = aTriplete(a);
  const tb = aTriplete(b);
  const pa = ta ? parsearTriplete(ta) : null;
  const pb = tb ? parsearTriplete(tb) : null;
  if (!pa || !pb) return 0;
  const la = luminancia(hslARgb(pa.h, pa.s, pa.l));
  const lb = luminancia(hslARgb(pb.h, pb.s, pb.l));
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * LOS DOS UMBRALES DE AA, y son distintos a propósito (WCAG 2.1, criterios 1.4.3 y
 * 1.4.11): el texto normal exige 4.5:1 y los elementos de interfaz —un borde, un
 * anillo de foco, el trazo de un icono— 3:1. Aplicar 4.5 a todo sería rechazar
 * combinaciones que la norma acepta; aplicar 3 a todo sería dejar pasar texto ilegible.
 */
export const AA_TEXTO = 4.5;
export const AA_INTERFAZ = 3;

export function cumpleTexto(fondo: TripleteHsl, texto: TripleteHsl): boolean {
  return contraste(fondo, texto) >= AA_TEXTO;
}

export function cumpleInterfaz(fondo: TripleteHsl, elemento: TripleteHsl): boolean {
  return contraste(fondo, elemento) >= AA_INTERFAZ;
}

/**
 * EL «SOBRE QUÉ SE ESCRIBE»: elige, entre los dos colores de texto que declara el
 * modelo, el que más contrasta con la superficie.
 *
 * ESTO ES LO QUE EL ADMIN NO PUEDE TOCAR, y es la decisión de accesibilidad más
 * importante de todo el sistema (§3.3 del diseño): elegir «azul de marca» es una
 * decisión de marca, elegir qué color de letra va encima es una decisión de contraste.
 * La segunda la toma la máquina, siempre, con los dos candidatos del modelo.
 *
 * Devuelve el candidato ganador; quien llama comprueba después si ese ganador alcanza
 * AA, porque un color de marca muy medio (un gris a media luz) puede no llegar a 4.5
 * con NINGUNO de los dos, y eso es exactamente lo que hay que rechazar con un 422 en
 * vez de aceptar el «menos malo».
 */
export function mejorTextoSobre(
  superficie: TripleteHsl,
  candidatos: readonly [TripleteHsl, TripleteHsl],
): TripleteHsl {
  const [a, b] = candidatos;
  return contraste(superficie, a) >= contraste(superficie, b) ? a : b;
}
