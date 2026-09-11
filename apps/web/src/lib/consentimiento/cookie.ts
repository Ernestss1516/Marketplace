import { CATEGORIAS, MAX_AGE_SEGUNDOS, NOMBRE_COOKIE, VERSION_TEXTO, type Categoria } from './constantes';

/**
 * COOKIES RÁFAGA 1 — LA COOKIE DE CONSENTIMIENTO.
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.2.
 *
 * ─── POR QUÉ UNA COOKIE Y NO `localStorage` ─────────────────────────────────────
 *
 * Porque viaja en la petición, así que el día que algo tenga que leerla en servidor ya
 * está ahí, y porque es lo que la propia política tiene que declarar: guardar la
 * elección del usuario en un sitio que la política no menciona sería empezar mintiendo.
 *
 * ─── POR QUÉ NO ES `httpOnly` ───────────────────────────────────────────────────
 *
 * Porque el gate corre en el navegador y tiene que leerla. Es la única razón, y basta:
 * aquí no hay nada que proteger de un script —la cookie guarda una preferencia pública
 * del propio usuario, no una credencial—, al contrario que la de sesión.
 *
 * ─── TODO LO ILEGIBLE ES «NO HA DECIDIDO» ───────────────────────────────────────
 *
 * Una cookie corrupta, truncada, de una versión desconocida o con una categoría que ya
 * no existe se trata como AUSENTE. Nunca se interpreta a medias: media cookie leída mal
 * podría significar «consintió» sin que nadie lo haya consentido, y ése es el único
 * error que este sistema no se puede permitir.
 */

export interface Consentimiento {
  /** Versión del texto que el usuario tenía delante al decidir. */
  version: string;
  /** Categorías aceptadas. Vacío = rechazó (que es una decisión, no una ausencia). */
  categorias: Categoria[];
  /** Epoch en segundos. */
  fecha: number;
  /** El id del `ConsentRecord` que lo prueba, si se llegó a registrar. */
  id: string | null;
}

interface CookieCruda {
  v?: unknown;
  c?: unknown;
  t?: unknown;
  id?: unknown;
}

/** Las categorías conocidas, filtrando cualquier cosa que ya no exista. */
function categoriasValidas(valor: unknown): Categoria[] {
  if (!Array.isArray(valor)) return [];
  const conocidas = CATEGORIAS as readonly string[];
  return valor.filter((c): c is Categoria => typeof c === 'string' && conocidas.includes(c));
}

/**
 * Parsea el valor crudo de la cookie. Exportada y PURA para poder probarla sin montar un
 * navegador: es la pieza que decide si alguien consintió, así que tiene que ser la más
 * fácil de examinar de todo el sistema.
 *
 * Devuelve `null` para todo lo que no sea una cookie íntegra y de la versión vigente.
 * **Una versión distinta se descarta**: es exactamente el mecanismo de re-consentimiento
 * (D5) — si el admin sube la versión, la cookie vieja deja de valer y se vuelve a
 * preguntar.
 */
export function parsearConsentimiento(valor: string | undefined | null): Consentimiento | null {
  if (!valor) return null;

  let crudo: CookieCruda;
  try {
    crudo = JSON.parse(decodeURIComponent(valor)) as CookieCruda;
  } catch {
    return null;
  }

  if (!crudo || typeof crudo !== 'object') return null;
  if (typeof crudo.v !== 'string' || crudo.v !== VERSION_TEXTO) return null;
  if (typeof crudo.t !== 'number' || !Number.isFinite(crudo.t)) return null;

  return {
    version: crudo.v,
    categorias: categoriasValidas(crudo.c),
    fecha: crudo.t,
    id: typeof crudo.id === 'string' && crudo.id.length > 0 ? crudo.id : null,
  };
}

/** Serializa al formato compacto que viaja en la cookie. */
export function serializarConsentimiento(c: Consentimiento): string {
  return encodeURIComponent(JSON.stringify({ v: c.version, c: c.categorias, t: c.fecha, id: c.id }));
}

/**
 * Lee la cookie del documento. Devuelve `null` fuera del navegador (SSR) — que es el
 * estado correcto ahí: **el HTML cacheado no sabe, ni debe saber, lo que consintió
 * nadie** (§1.1 del diseño).
 */
export function leerConsentimiento(): Consentimiento | null {
  if (typeof document === 'undefined') return null;
  const prefijo = `${NOMBRE_COOKIE}=`;
  const cruda = document.cookie
    .split('; ')
    .find((trozo) => trozo.startsWith(prefijo))
    ?.slice(prefijo.length);
  return parsearConsentimiento(cruda);
}

/**
 * Escribe la cookie. `SameSite=Lax` y `path=/` como el resto del repo; `Secure` sólo
 * bajo HTTPS, porque ponerlo en `http://localhost` haría que el navegador la descartara
 * en silencio y el consentimiento no se guardaría nunca en desarrollo.
 */
export function escribirConsentimiento(c: Consentimiento): void {
  if (typeof document === 'undefined') return;
  const seguro = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${NOMBRE_COOKIE}=${serializarConsentimiento(c)}` +
    `; Max-Age=${MAX_AGE_SEGUNDOS}; Path=/; SameSite=Lax${seguro}`;
}
