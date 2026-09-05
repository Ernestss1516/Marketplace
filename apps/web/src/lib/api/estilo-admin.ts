import { apiFetch, type ApiErrorContrastFailure } from './client';
import type { EstiloResuelto } from './estilo';

/**
 * E9 — EL CLIENTE DE ADMIN DEL SISTEMA DE ESTILO. Molde `branding-admin.ts`.
 *
 * SEPARADO DE `estilo.ts`, Y NO ES ORDEN: aquél envuelve la lectura en `unstable_cache`,
 * que es **sólo de servidor**, así que importarlo desde esta pantalla —que es cliente—
 * rompería el build. Y aunque se pudiera, no se querría: quien acaba de guardar un tema
 * tiene que ver **lo que hay ahora**, no lo que la caché del sitio público sirva durante
 * los segundos siguientes. Es la misma frontera, palabra por palabra, que separa
 * `branding-admin.ts` de `branding.ts`.
 *
 * Las tres operaciones devuelven el tema RESUELTO —el mismo cuerpo que `GET /estilo`—, así
 * que la pantalla se repinta con la respuesta del servidor y no con lo que creyó mandar.
 */

/** Los cuatro colores que el admin elige. No hay un quinto: ver `SetEstiloDto`. */
export interface ColoresConfigurables {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
}

/** Un modelo del catálogo, tal y como lo sirve `EstiloService.catalogo()`. */
export interface ModeloDelCatalogo {
  id: string;
  nombre: string;
  descripcion: string;
  versiones: string[];
  coloresPorDefecto: ColoresConfigurables;
}

/** Lo guardado (o lo de fábrica, si no hay fila). */
export interface EstiloConfig {
  modelo: string;
  version: string;
  colores: ColoresConfigurables;
}

/** Lo que devuelve `GET /admin/estilo`: todo lo que la pantalla necesita, de una vez. */
export interface EstadoEstilo {
  catalogo: ModeloDelCatalogo[];
  config: EstiloConfig;
  resuelto: EstiloResuelto;
}

export function getEstiloAdmin(token: string): Promise<EstadoEstilo> {
  return apiFetch<EstadoEstilo>('/admin/estilo', { token });
}

/**
 * Guarda modelo + versión + los cuatro colores. **Se manda entero**, como pide el
 * endpoint: los colores se eligen juntos y se validan juntos contra AA, así que un envío
 * parcial obligaría al servidor a validar una combinación que el admin no ha visto.
 */
export function setEstilo(
  entrada: { modelo: string; version: string; colores: ColoresConfigurables },
  token: string,
): Promise<EstiloResuelto> {
  return apiFetch<EstiloResuelto>('/admin/estilo', {
    method: 'PUT',
    token,
    body: JSON.stringify(entrada),
  });
}

/** Vuelve al Modelo 0 de fábrica. Idempotente, como `clearLogo`. */
export function resetEstilo(token: string): Promise<EstiloResuelto> {
  return apiFetch<EstiloResuelto>('/admin/estilo', { method: 'DELETE', token });
}

// ── El 422 de contraste, traducido al campo que hay que tocar ────────────────────────

export type RanuraDeColor = keyof ColoresConfigurables;

/**
 * ⚠ DE LA PAREJA MEDIDA AL COLOR QUE SE PUEDE CORREGIR. Es la pieza con enjundia de esta
 * pantalla, y conviene entender por qué hace falta.
 *
 * El backend mide **entre tokens derivados** y nombra la medición en castellano: «letra
 * sobre el color principal», «texto atenuado sobre el fondo». Eso describe exactamente lo
 * que falló, pero **no dice qué mover**: el admin no tiene un mando para «la letra sobre
 * el principal» —la elige la máquina por contraste (decisión #2 de E4a)— ni para «el
 * fondo», que sale de la rampa del neutro. Sólo tiene cuatro mandos.
 *
 * Así que la traducción es de una medición a la ÚNICA palanca que la mueve:
 *
 *  · las tres parejas de marca (`primary`/`secondary`/`accent` contra su letra) señalan a
 *    su color, que es el que el admin acaba de elegir;
 *  · las cuatro de la rampa (fondo, texto atenuado, tarjeta, capa flotante) y el borde de
 *    campo salen TODAS del `neutral` — `resolverTokens` construye la rampa entera a
 *    partir de él, así que es el único mando que las mueve;
 *  · el anillo de foco es `primary` literal (`tokens.ring = colores.primary`), no un
 *    derivado del neutro: aunque la frase diga «sobre el fondo», lo que hay que aclarar
 *    u oscurecer es el principal.
 *
 * ── POR QUÉ AQUÍ Y NO EN EL BACKEND ─────────────────────────────────────────────────
 *
 * Porque no es una regla de negocio: el 422 ya es completo y correcto sin esto. Es una
 * decisión de PRESENTACIÓN —junto a qué campo del formulario se pinta cada fallo—, y el
 * formulario es lo único que sabe que tiene cuatro campos. Un `culpable` en la respuesta
 * del servidor sería el backend opinando sobre la maquetación de una pantalla.
 *
 * ── LA DEUDA QUE ESTO CONTRAE, Y CÓMO SE PAGA ───────────────────────────────────────
 *
 * Casa por TEXTO con frases que viven en otro fichero de otra app. Si alguien renombra
 * una pareja allí, aquí dejaría de casar **en silencio**: el fallo volvería al pie del
 * formulario en vez de al campo, sin romper nada. Por eso hay dos cosas y no una:
 *
 *  · el fallo sin traducir NO se pierde — `fallosPorRanura` lo devuelve aparte y la
 *    pantalla lo pinta igualmente, con su ratio, arriba;
 *  · y `parejas-espejo.spec.ts`, en `apps/api`, comprueba que cada pareja bloqueante del
 *    backend tiene entrada en este mapa. Cruza la frontera entre apps a propósito, con el
 *    mismo argumento que `globals-espejo.spec.ts`: es un monorepo, los dos ficheros se
 *    despliegan juntos, y la alternativa es confiar en que nadie lo olvide.
 */
export const COLOR_CULPABLE: Readonly<Record<string, RanuraDeColor>> = {
  'letra sobre el color principal': 'primary',
  'letra sobre el secundario': 'secondary',
  'letra sobre el de resalte': 'accent',
  'anillo de foco sobre el fondo': 'primary',
  'texto base sobre el fondo': 'neutral',
  'texto atenuado sobre el fondo': 'neutral',
  'texto de la tarjeta': 'neutral',
  'texto de la capa flotante': 'neutral',
  'borde de campo sobre el fondo': 'neutral',
};

export interface FallosDeContraste {
  /** Los que se pintan JUNTO A SU CAMPO. */
  porRanura: Partial<Record<RanuraDeColor, ApiErrorContrastFailure[]>>;
  /** Los que no se supieron traducir. Se pintan aparte — nunca se descartan. */
  sinUbicar: ApiErrorContrastFailure[];
}

/** Reparte los fallos del 422 entre los cuatro campos. Pura: se prueba valor a valor. */
export function fallosPorRanura(fallos: ApiErrorContrastFailure[]): FallosDeContraste {
  const porRanura: Partial<Record<RanuraDeColor, ApiErrorContrastFailure[]>> = {};
  const sinUbicar: ApiErrorContrastFailure[] = [];

  for (const fallo of fallos) {
    const ranura = COLOR_CULPABLE[fallo.pareja];
    if (!ranura) {
      sinUbicar.push(fallo);
      continue;
    }
    (porRanura[ranura] ??= []).push(fallo);
  }

  return { porRanura, sinUbicar };
}

/**
 * «3,1:1 — necesita 4,5:1». Con coma decimal, que es como se escriben los números en la
 * interfaz, y con el mínimo AL LADO: un ratio suelto no le dice a nadie si va sobrado o
 * corto. Es la mitad del trabajo de esta pantalla — la otra mitad es enseñarlo en el
 * campo correcto.
 */
export function textoDeFallo(fallo: ApiErrorContrastFailure): string {
  const n = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return `${fallo.pareja}: ${n(fallo.contrasteActual)}:1 — necesita ${n(fallo.contrasteMinimo)}:1`;
}

// ── El valor para el selector de color nativo ────────────────────────────────────────

/**
 * Triplete HSL → `#rrggbb`, SÓLO para poner un valor en `<input type="color">`.
 *
 * ── POR QUÉ HAY ARITMÉTICA DE COLOR EN EL FRONTEND, QUE ES LO QUE HABRÍA QUE VIGILAR ──
 *
 * Porque `<input type="color">` **no acepta otra cosa**: no entiende `hsl()`, ni
 * variables, ni tripletes. Es una limitación del control del navegador, y la conversión
 * es para PINTAR EL MANDO, no para decidir nada. Todo lo demás sigue donde estaba: lo que
 * se manda al servidor es el hexadecimal que devuelve el selector, y quien lo normaliza a
 * triplete —una vez, al guardar— es `EstiloService.normalizarColores`. Aquí no se guarda,
 * no se valida y no se deriva ningún token.
 *
 * Las muestras de color de la pantalla NO pasan por aquí: `hsl(221.2 83.2% 53.3%)` es CSS
 * válido y el navegador lo pinta solo. Esta función existe por un solo control.
 *
 * Devuelve `null` si la entrada no es un triplete legible —un hexadecimal ya guardado, por
 * ejemplo—, y quien llama lo usa tal cual. No inventa un color de emergencia: enseñar un
 * gris en el mando haría creer al admin que ése es su color.
 */
export function tripleteAHexParaSelector(v: string): string | null {
  const m = /^\s*(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/.exec(v);
  if (!m) return null;
  const [h, s, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![h, s, l].every(Number.isFinite)) return null;
  if (s < 0 || s > 100 || l < 0 || l > 100) return null;

  // El mismo algoritmo HSL→RGB que `hslARgb` en el backend. Ocho líneas de aritmética
  // estándar; se escriben aquí en vez de importarse porque `apps/web` no importa de
  // `apps/api` en producción, y añadir una dependencia entre apps por un selector de
  // color sería pagar mucho más de lo que cuesta.
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const dos = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0');

  return `#${dos(f(0))}${dos(f(8))}${dos(f(4))}`;
}

/** Lo que se pinta como muestra: CSS entiende el triplete y el hexadecimal igual de bien. */
export function comoColorCss(v: string): string {
  return /^#?[0-9a-fA-F]{6}$/.test(v.trim())
    ? v.trim().startsWith('#')
      ? v.trim()
      : `#${v.trim()}`
    : `hsl(${v})`;
}
