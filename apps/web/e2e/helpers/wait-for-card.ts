import type { Page } from '@playwright/test';

/**
 * ¿Corriendo en CI? GitHub Actions define CI=true.
 *
 * MISMA POLÍTICA que `apps/api/test/helpers/async-state.ts` (plazo que escala al
 * CI + backoff + error que distingue "lento" de "roto"), REPLICADA a propósito y
 * no importada: ese helper vive en el paquete `apps/api` y este en `apps/web`, y
 * el workspace solo declara `apps/*` — no hay un paquete común donde alojar la
 * política. Crear uno para esto es una decisión de estructura del monorepo, no
 * algo que deba colarse en un arreglo de tests. Si algún día se crea, ESTE es el
 * primer candidato a mudarse: si tocas una de las dos políticas, toca la otra.
 */
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

/**
 * Plazo por defecto. Los 45 s fijos de antes se quedaban cortos: medido sobre
 * corridas reales, los aciertos se agrupaban en **29-30 recargas** — y 30 es
 * justo el techo que dan 45 s a 1,5 s por vuelta. O sea, casi todos los aciertos
 * rozaban el límite en LOCAL; en el CI, más lento, se caían al otro lado.
 *
 * POR QUÉ TARDA TANTO (y por qué no se arregla "esperando mejor" nada más):
 * publicar SIN coordenadas explícitas encola un job `geocode`
 * (`listings.service.ts`: `if (dto.latitude == null && dto.longitude == null)`),
 * y `handleGeocode()` REINDEXA al terminar. La card no queda estable hasta que
 * ese viaje a Nominatim (externo, limitado a ~1 req/s) termina. Los specs de
 * backend lo esquivan pasando `latitude`/`longitude` a mano (ver la nota de B2 en
 * `tags-b2.e2e-spec.ts`), pero estos specs publican **por el wizard de la UI**,
 * que no ofrece campos de coordenadas: aquí el geocodificado es inevitable, así
 * que el plazo tiene que cubrirlo.
 *
 * Cuesta CERO en el camino feliz: se vuelve en cuanto la card aparece.
 *
 * EL PLAZO SALE DE UNA MEDICIÓN, no de "por si acaso". Se probó primero con
 * 120 s en CI y **no arregló nada**: los que fallaban seguían fallando tras 43
 * recargas y 120 s enteros. Es decir, entre los 45 s y los 120 s no aparece ni
 * una sola card — lo que fallaba no es lento, está roto (ver §9 del plan). Así
 * que inflar más el plazo solo alargaría el CI a cambio de nada: 2× sobre el
 * peor caso REAL observado (~45 s bajo carga de suite completa) es lo que hay
 * evidencia para justificar.
 */
const DEFAULT_TIMEOUT_MS = IS_CI ? 90_000 : 45_000;

/** Backoff: sondear pronto (por si la indexación ya terminó) y espaciar después,
 *  en vez de recargar la página cada 1,5 s hasta agotar el plazo. Cada vuelta es
 *  un `goto` completo con render SSR: martillear tiene coste real en el runner. */
const INITIAL_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 3_000;
const BACKOFF_FACTOR = 1.5;

/**
 * Recarga `url` hasta que aparece una card cuyo enlace contiene `title`.
 *
 * Las páginas de categoría y de búsqueda (/coches, /vehiculos, /busqueda…) son
 * SSR puro: el servidor consulta Meilisearch en cada petición y devuelve una foto
 * estática. Tras publicar, la card solo aparece en una carga NUEVA cuando han
 * terminado dos pasos asíncronos:
 *   1. El job 'index' de BullMQ ha corrido y `indexListing()` ha terminado.
 *   2. Meilisearch ha procesado su tarea interna (`waitForTask`).
 * (Y, si el anuncio no traía coordenadas, además el `geocode` + su reindex.)
 *
 * Un `toBeVisible({ timeout: N })` pasivo sobre un DOM SSR estático no provoca
 * ningún re-render: o encuentra la card en la primera carga o agota el plazo. El
 * sondeo activo con recargas es la estrategia correcta, y el predicado —¿está la
 * card?— ya es el estado que importa; lo que se corrige aquí es el PLAZO y el
 * RITMO, no qué se espera.
 *
 * Generoso pero FINITO: si la card no llega nunca porque algo está roto, esto
 * sigue poniendo el test en rojo con un mensaje que lo dice, no se cuelga.
 */
export async function waitForCard(
  page: Page,
  url: string,
  title: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let interval = INITIAL_INTERVAL_MS;

  while (true) {
    attempts++;
    await page.goto(url);
    const card = page
      .locator('a[href*="/anuncio/"]')
      .filter({ hasText: title })
      .first();

    if (await card.isVisible()) {
      console.log(
        `[waitForCard] found after ${attempts} reload(s) in ${timeoutMs - (deadline - Date.now())}ms: "${title.slice(0, 50)}"`,
      );
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(interval, remaining));
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_INTERVAL_MS);
  }

  throw new Error(
    `[waitForCard] Card not found after ${attempts} reload(s) (${timeoutMs}ms timeout${IS_CI ? ', CI' : ''}).\n` +
      `  url:   ${url}\n` +
      `  title: ${title.slice(0, 80)}\n` +
      `La indexación en Meilisearch no completó a tiempo. Si esto falla SIEMPRE (y no solo\n` +
      `bajo carga), no es lentitud: mira el worker de BullMQ, el job 'geocode' del anuncio\n` +
      `(publicar sin coordenadas reindexa al terminar) o que el anuncio quedara ACTIVE.`,
  );
}
