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
 * Cuánto espera CADA vuelta a que la card se vuelva visible antes de recargar.
 *
 * Medido: la card se estabiliza a los ~350 ms del `goto`, así que 2 s la cazan de
 * sobra en la PRIMERA vuelta — el helper debería resolver en 1 iteración, no en
 * 33. No se pone más alto para que una card que de verdad no llega no tarde de
 * más en dar la vuelta y recargar (que sigue siendo la estrategia correcta para
 * una página SSR: sin recarga no hay contenido nuevo).
 */
const PER_ATTEMPT_WAIT_MS = 2_000;

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
/**
 * INSTRUMENTO DE DIAGNÓSTICO (opt-in con `DIAG_WAITFORCARD=1`). Solo OBSERVA.
 *
 * Existe porque toda la evidencia sobre los rojos de familia 2a era *post mortem*:
 * al terminar la corrida el anuncio estaba en Postgres, en Meili, lo devolvía
 * `/api/search` y las cuatro páginas lo pintaban — pero DURANTE la corrida
 * `waitForCard` no lo encontraba. Esto mira las cuatro capas EN CADA VUELTA, que
 * es lo único que separa las explicaciones sin razonar sobre ellas:
 *
 *   meili=NO  api=NO   → la indexación va tarde de verdad (explicación A)
 *   meili=SI  api=SI  html=NO → el servidor no lo pinta pese a tenerlo (B)
 *   meili=SI  api=SI  html=SI  loc=NO → lo pinta y el LOCATOR no casa (tercera causa)
 */
async function sondear(page: Page, title: string): Promise<string> {
  const partes: string[] = [];

  // 1. ¿Está el documento en Meilisearch AHORA? (directo, sin pasar por la API)
  try {
    const host = process.env.MEILI_HOST ?? 'http://localhost:7700';
    const idx = process.env.MEILI_INDEX_NAME ?? 'listings_test';
    const res = await fetch(`${host}/indexes/${idx}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MEILI_MASTER_KEY ?? ''}`,
      },
      body: JSON.stringify({ q: title, limit: 5 }),
    });
    const body = (await res.json()) as { hits?: { title?: string }[]; estimatedTotalHits?: number };
    const hay = (body.hits ?? []).some((h) => h.title === title);
    partes.push(`meili=${hay ? 'SI' : 'no'}(${body.estimatedTotalHits ?? '?'})`);
  } catch (e) {
    partes.push(`meili=ERR(${String(e).slice(0, 40)})`);
  }

  // 2. ¿Lo devuelve la API AHORA? (lo mismo que consulta el SSR de la página)
  try {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
    const res = await fetch(`${api}/search?q=${encodeURIComponent(title)}`);
    const body = (await res.json()) as { hits?: { title?: string }[]; totalHits?: number };
    const hay = (body.hits ?? []).some((h) => h.title === title);
    partes.push(`api=${hay ? 'SI' : 'no'}(${body.totalHits ?? '?'})`);
  } catch (e) {
    partes.push(`api=ERR(${String(e).slice(0, 40)})`);
  }

  // 3. ¿El HTML que recibió el navegador contiene el título? Separa "el servidor
  //    no lo pinta" de "lo pinta pero el locator no casa".
  //    OJO: `content()` incluye los <script> con la RSC payload, así que un SI
  //    aquí NO prueba que la card esté pintada — por eso van también los dos
  //    sondeos de abajo.
  try {
    partes.push(`html=${(await page.content()).includes(title) ? 'SI' : 'no'}`);
  } catch {
    partes.push('html=ERR');
  }

  // 4. ¿Está en el TEXTO VISIBLE (no en un <script>)? Y ¿cuántas cards de anuncio
  //    hay en la página? Esto separa "la card está pintada y el locator falla" de
  //    "el título solo viaja en la RSC payload y no hay card ninguna".
  try {
    const visible = await page.evaluate(
      (t) => ({
        enTexto: (document.body.innerText || '').includes(t),
        anclas: document.querySelectorAll('a[href*="/anuncio/"]').length,
        titulos: Array.from(document.querySelectorAll('a[href*="/anuncio/"]'))
          .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim()),
      }),
      title,
    );
    partes.push(`texto=${visible.enTexto ? 'SI' : 'no'} anclas=${visible.anclas}`);
    if (visible.anclas > 0) {
      // La card está en el DOM (querySelectorAll y textContent la ven) pero ni
      // innerText ni Playwright la ven → está OCULTA. Buscar QUÉ la oculta:
      // subir por los ancestros hasta dar con el que tiene display:none /
      // visibility:hidden / tamaño 0.
      const oculto = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/anuncio/"]');
        if (!a) return 'sin ancla';
        const r = a.getBoundingClientRect();
        let el: Element | null = a;
        const cadena: string[] = [];
        while (el && el !== document.documentElement) {
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (cs.display === 'none' || cs.visibility === 'hidden' || (rect.width === 0 && rect.height === 0)) {
            cadena.push(
              `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}"> ` +
                `display=${cs.display} visibility=${cs.visibility} w=${Math.round(rect.width)} h=${Math.round(rect.height)}`,
            );
          }
          el = el.parentElement;
        }
        return `rectAncla=${Math.round(r.width)}x${Math.round(r.height)} | ocultadores: ${cadena.length ? cadena.join(' <= ') : '(ninguno)'}`;
      });
      partes.push(`\n    ${oculto}`);
    }
  } catch (e) {
    partes.push(`dom=ERR(${String(e).slice(0, 30)})`);
  }

  return partes.join(' ');
}

export async function waitForCard(
  page: Page,
  url: string,
  title: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const t0 = Date.now();
  const DIAG = process.env.DIAG_WAITFORCARD === '1';
  let attempts = 0;
  let interval = INITIAL_INTERVAL_MS;

  while (true) {
    attempts++;
    await page.goto(url);
    const card = page
      .locator('a[href*="/anuncio/"]')
      .filter({ hasText: title })
      .first();

    // ESPERAR al estado, no MUESTREAR el instante. Esto era el bug de la familia
    // 2a, confirmado observando en vivo: aquí había un `card.isVisible()` que
    // preguntaba justo al volver el `goto`, y en ese microsegundo el contenido de
    // la página cuelga de un `<div>` con `display:none` (transitorio de
    // transición/carga del App Router). La card ya está pintada, pero mide 0x0 →
    // `isVisible()` = false. Milisegundos después es visible (medido:
    // rect 233x364 a los ~350 ms), pero el helper ya se había rendido y recargaba,
    // reiniciando el MISMO transitorio. 33 vueltas seguidas cazando el peor
    // microsegundo. Por eso agrandar el plazo global (ráfaga D) no arreglaba nada.
    //
    // Las rutas no canónicas (308 → canónica) ensanchan esa ventana, y por eso el
    // único caso que pasaba era el de la URL canónica. Se arregla aquí, en el
    // helper, y no forzando URLs canónicas en los specs: los 308 son
    // comportamiento legítimo que los tests deben seguir ejerciendo.
    //
    // Misma lección que `async-state.ts` y el `pollUntil` de redsys: esperar al
    // ESTADO definitivo, no muestrear un sistema en movimiento.
    let visible = false;
    try {
      await card.waitFor({
        state: 'visible',
        // Nunca por encima de lo que queda del plazo global: el helper sigue
        // siendo FINITO y falla con su diagnóstico si la card no llega nunca.
        //
        // El `Math.max(1, …)` NO es cosmético: en Playwright `timeout: 0`
        // significa ESPERAR PARA SIEMPRE, no "no esperes". Con un
        // `Math.max(0, …)` aquí, la última vuelta —cuando ya no queda plazo—
        // pedía timeout 0 y se colgaba: medido, un helper con plazo de 8 s
        // tardaba 147 s en rendirse. Justo el fallo que este helper existe para
        // no tener. Un mínimo de 1 ms mantiene la semántica "queda nada, no
        // esperes" sin cruzar a "espera indefinidamente".
        timeout: Math.max(1, Math.min(PER_ATTEMPT_WAIT_MS, deadline - Date.now())),
      });
      visible = true;
    } catch {
      // No apareció en esta vuelta — se recarga, como antes.
      visible = false;
    }

    if (DIAG) {
      console.log(
        `[DIAG waitForCard] #${String(attempts).padStart(2)} t=${String(Date.now() - t0).padStart(6)}ms ` +
          `url=${url} loc=${visible ? 'SI' : 'no'} ${await sondear(page, title)}`,
      );
    }

    if (visible) {
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
