/**
 * BARRERA ESTRUCTURAL: cómo se espera un ESTADO ASÍNCRONO en los e2e.
 *
 * Mismo criterio que `e2e-lock.js` y `reset-redis-between-suites.ts` — un
 * mecanismo compartido, no una convención que cada test recuerde aplicar.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 * Casi todo lo interesante del backend termina en un job de BullMQ: publicar
 * un anuncio encola la indexación, un webhook de pago encola la concesión del
 * entitlement, etc. El test hace la petición HTTP y el efecto llega DESPUÉS.
 * Esperar mal produce rojos que rotan entre corridas (el CI, más lento y
 * cargado que local, ensancha la ventana) — y, peor, VERDES FALSOS.
 *
 * Se habían acumulado tres formas distintas de esperar mal:
 *
 *   1. PROBE QUE LANZA = FALLO INMEDIATO. Tres copias locales de `pollUntil`
 *      hacían `last = await fn()` sin try/catch. Con `getDocument()` de
 *      Meilisearch —que LANZA "Document not found" si el documento aún no
 *      está— el poll moría en la PRIMERA iteración. No agotaba el deadline:
 *      ni siquiera llegaba a la segunda vuelta. Subir el deadline no arreglaba
 *      nada porque el deadline nunca entraba en juego.
 *
 *   2. PREDICADO DE EXISTENCIA, NO DE ESTADO. Esperar a que "el documento
 *      exista" devuelve la PRIMERA versión escrita, que todavía puede cambiar
 *      (un job de geocode reindexa después, p. ej.). El test lee un documento
 *      en vuelo y la aserción sale verde o roja según los tiempos. Es la
 *      lección de B2, anotada en tags-b2.e2e-spec.ts. El caso extremo era un
 *      predicado literal `() => true`.
 *
 *   3. DEADLINE PENSADO PARA EL CASO FELIZ LOCAL. Un deadline de test debe
 *      cubrir el PEOR caso del CI, no el mejor caso de una máquina de
 *      desarrollo ociosa.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 * Esperar SIEMPRE al ESTADO DEFINITIVO (el valor que se va a afirmar), nunca a
 * la mera presencia. El predicado compara CONTENIDO. Que el probe lance es una
 * respuesta válida ("todavía no"), no un fallo.
 *
 * El deadline es generoso pero FINITO: un bug real (el documento no llega
 * nunca porque el código está roto) tiene que seguir poniendo el test en rojo,
 * no colgarlo. Por eso no hay ninguna vía de "esperar para siempre".
 */

/** ¿Corriendo en CI? GitHub Actions define CI=true. */
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

/**
 * Deadline por defecto. El CI (contenedores de servicio, runner compartido,
 * suites en serie) es varias veces más lento que local — un deadline que
 * cubre local NO cubre el CI, y ahí es donde rota el rojo.
 *
 * Cuesta CERO en el camino feliz: el poll vuelve en cuanto el predicado se
 * cumple, no espera al deadline. El deadline solo fija cuánto se tarda en
 * declarar un fallo REAL.
 */
export const DEFAULT_TIMEOUT_MS = IS_CI ? 60_000 : 20_000;

/**
 * Escala un plazo pensado para local al entorno real de ejecución.
 *
 * Para esperas que NO son jobs de BullMQ y tienen su propio orden de magnitud
 * (eventos de websocket, que deberían llegar en milisegundos): mantiene el
 * plazo ajustado, pero deja de ser el mismo número en una máquina de
 * desarrollo ociosa y en un runner del CI cargado.
 */
export function scaleForCi(localMs: number): number {
  return IS_CI ? localMs * 4 : localMs;
}

/** Backoff: sondear rápido al principio (la mayoría de jobs terminan en ~50-200 ms)
 *  y espaciar después, en vez de martillear cada 200 ms hasta el deadline. */
const INITIAL_INTERVAL_MS = 50;
const MAX_INTERVAL_MS = 500;
const BACKOFF_FACTOR = 1.5;

export interface PollOptions {
  timeoutMs?: number;
  /** Texto para el mensaje de error — qué se estaba esperando. */
  description?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function preview(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return String(value);
  }
}

/**
 * Sondea `probe` hasta que `predicate` acepta su valor, y devuelve ese valor.
 *
 * - Si `probe` LANZA, se trata como "todavía no" y se reintenta (este es el
 *   fallo que mataba a redsys-featured en la primera iteración).
 * - `predicate` debe comprobar el ESTADO DEFINITIVO, no la mera existencia.
 * - Al agotarse el deadline lanza con el último valor Y el último error, que
 *   es lo que hace falta para diagnosticar sin reproducir.
 *
 * Siempre hace una última comprobación al vencer el deadline, para que un
 * efecto que llega justo en el límite no produzca un rojo por un milisegundo.
 */
export async function pollFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const what = opts.description ?? 'condición asíncrona';
  const deadline = Date.now() + timeoutMs;

  let interval = INITIAL_INTERVAL_MS;
  let lastValue: T | undefined;
  let lastError: unknown;
  let attempts = 0;
  let sawValue = false;

  // do/while: garantiza una comprobación final DESPUÉS de que venza el deadline.
  let expired = false;
  do {
    expired = Date.now() >= deadline;
    attempts += 1;
    try {
      const value = await probe();
      lastValue = value;
      sawValue = true;
      lastError = undefined;
      if (predicate(value)) return value;
    } catch (err) {
      // "Todavía no" — p. ej. getDocument() de Meili lanza si el documento aún
      // no está indexado. NO es un fallo del test: es el estado que esperamos.
      lastError = err;
    }
    if (expired) break;
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_INTERVAL_MS);
  } while (true);

  const detail = sawValue
    ? `Último valor observado: ${preview(lastValue)}`
    : `El probe nunca devolvió un valor. Último error: ${
        lastError instanceof Error ? lastError.message : preview(lastError)
      }`;

  throw new Error(
    `Timeout esperando ${what}: no se alcanzó el estado esperado en ${timeoutMs} ms ` +
      `(${attempts} intentos${IS_CI ? ', CI' : ''}). ${detail}\n` +
      `Si esto falla SIEMPRE, el efecto asíncrono no está ocurriendo (worker de BullMQ caído, ` +
      `job que revienta, índice/entorno mal configurado) — no es un problema de espera.`,
  );
}

/**
 * Espera a que una condición booleana se cumpla.
 *
 * Envoltorio de `pollFor` para los casos en que el probe ya devuelve el
 * booleano (consultas a Postgres, contadores de cola). Las mismas garantías:
 * un probe que lanza es "todavía no", y el deadline cubre el CI.
 */
export async function waitUntil(
  check: () => Promise<boolean>,
  opts: PollOptions = {},
): Promise<void> {
  await pollFor(check, (ok) => ok === true, opts);
}
