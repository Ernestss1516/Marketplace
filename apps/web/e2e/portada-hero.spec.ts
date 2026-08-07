// PORTADA CONFIGURABLE — RP.1: el hero y su título rotativo.
//
// Es la pieza SIN precedente del proyecto (no había ninguna animación de texto
// en el repo antes de esta ráfaga), y sus tres propiedades no se pueden
// comprobar con un test unitario porque viven en el HTML servido, en el árbol
// de accesibilidad y en el motor de CSS:
//
//   1. SEO       — el <h1> SERVIDO contiene la parte fija y las N opciones. Se
//                  comprueba sobre el HTML crudo, sin navegador: si estuviera
//                  puesto por JS, este test fallaría.
//   2. A11Y      — el NOMBRE ACCESIBLE del <h1> es "parte fija + PRIMERA opción",
//                  no la ristra de las N. Lo garantiza aria-hidden en las 2…N.
//   3. MOVIMIENTO— con prefers-reduced-motion se ve la primera opción y solo la
//                  primera, sin animación: lo que se VE coincide exactamente con
//                  lo que se OYE.
//
// ── Por qué UNA fase de escritura y luego solo lecturas ─────────────────────
// La config se sirve desde `unstable_cache` (tag 'homepage-config', TTL 1 h) y
// la invalidación la dispara el backend FIRE-AND-FORGET (RevalidateService
// lanza el fetch a /api/revalidate sin esperarlo): entre el PATCH y la
// invalidación efectiva hay una ventana real. Mismo patrón que
// nav-publico.spec.ts: se escribe una vez en beforeAll, se espera una vez a que
// la caché lo refleje, y los tests solo leen.
//
// La config es estado GLOBAL compartido con el resto de la batería, así que se
// restaura al terminar.
//
// Prerequisites: global-setup siembra admin-e2e@example.com (ADMIN).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApiToken, authedPatch } from './helpers/api';
import { PORTADA_SEMILLA } from './helpers/portada';

const STATIC_TITLE = 'Compra y vende';
const OPTIONS = ['coches', 'bicicletas', 'muebles'];
const SUBTITLE = 'Miles de anuncios cerca de ti';
const ROTATION_MS = 2000;

// Lo que siembra prisma/seed-test.ts, desde su FUENTE ÚNICA (helpers/portada.ts).
// Tiene que coincidir exactamente: restaurar de menos deja la portada mutilada
// para todo lo que corra después. Con una copia local aquí se quedaría atrás en
// cuanto la semilla crezca — que es justo lo que pasó en RP.4.
const DEFAULTS = PORTADA_SEMILLA;

// CERO logins: el token lo obtiene globalSetup UNA vez para toda la corrida
// (ver `adminApiToken` en helpers/api.ts). Este fichero llegó a memoizar su
// propio login por este mismo motivo; ahora ni eso hace falta.
async function setConfig(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await authedPatch(request, '/admin/homepage', adminApiToken(), data);
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * Espera a que la portada refleje la config recién escrita, RECARGANDO en cada
 * intento: reintentar solo la aserción no sirve: `expect` reconsulta el DOM de
 * una página ya pintada, y esa página se pintó con lo que hubiera en caché. Lo
 * único que trae contenido nuevo es volver a pedirla.
 */
async function esperarHero(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const texto = await page.locator('h1').first().innerText();
    if (!texto.includes(OPTIONS[0])) {
      throw new Error(`el hero aún no refleja la config (h1="${texto}")`);
    }
  }).toPass({ timeout: 30_000 });
}

test.describe('Portada — hero con título rotativo', () => {
  test.beforeAll(async ({ browser, request }) => {
    await setConfig(request, {
      heroStaticTitle: STATIC_TITLE,
      heroRotatingOptions: OPTIONS,
      heroRotationMs: ROTATION_MS,
      heroSubtitle: SUBTITLE,
      blocks: [],
    });

    const warmup = await browser.newPage();
    await esperarHero(warmup);
    await warmup.close();
  });

  // SIN afterAll aquí a propósito. La restauración vive UNA sola vez, al final
  // del fichero (el describe de abajo), y este describe deja la config puesta
  // para que el siguiente la sobrescriba directamente.
  //
  // POR QUÉ: la invalidación de caché es fire-and-forget (RevalidateService
  // lanza el fetch a /api/revalidate sin esperarlo). Con un restore aquí había
  // DOS escrituras seguidas —restaurar y volver a escribir— cuyas
  // invalidaciones pueden aterrizar en orden inverso: la del restore llegando
  // DESPUÉS deja servida la config vieja y el test siguiente lee lo que no es.
  // Se vio exactamente eso: verde en aislado, rojo en la batería completa.
  // Una sola escritura entre describes elimina la carrera de raíz.

  // ── 1. SEO: el texto está en el HTML SERVIDO ────────────────────────────────

  test('el <h1> servido contiene la parte fija y TODAS las opciones', async ({ request }) => {
    // Petición HTTP cruda, sin navegador y por tanto sin ejecutar una sola línea
    // de JS: esto es exactamente lo que ve un crawler. Un <h1> rellenado por
    // JavaScript no pasaría de aquí.
    const res = await request.get('http://localhost:3000/');
    expect(res.status()).toBe(200);
    const html = await res.text();

    const h1 = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0];
    expect(h1, 'la portada debe servir un <h1>').toBeTruthy();

    expect(h1).toContain(STATIC_TITLE);
    for (const option of OPTIONS) {
      expect(h1).toContain(option);
    }
  });

  test('el subtítulo también viaja en el HTML servido', async ({ request }) => {
    const res = await request.get('http://localhost:3000/');
    expect(await res.text()).toContain(SUBTITLE);
  });

  // ── 2. A11Y: una sola frase, no una ristra ─────────────────────────────────

  test('el nombre accesible del <h1> es la parte fija + la PRIMERA opción', async ({ page }) => {
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1 });

    // Lo que anuncia un lector de pantalla. Si faltara el aria-hidden de las
    // opciones 2…N, aquí saldría "Compra y vende coches bicicletas muebles".
    await expect(h1).toHaveAccessibleName(`${STATIC_TITLE} ${OPTIONS[0]}`);
  });

  test('solo la primera opción es contenido semántico; las demás son decoración', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.hero-rot-item');
    await expect(items).toHaveCount(OPTIONS.length);

    await expect(items.nth(0)).not.toHaveAttribute('aria-hidden', 'true');
    await expect(items.nth(1)).toHaveAttribute('aria-hidden', 'true');
    await expect(items.nth(2)).toHaveAttribute('aria-hidden', 'true');
  });

  // ── 3. La animación ────────────────────────────────────────────────────────

  test('la rotación corre con la velocidad configurada y sin salto de layout', async ({ page }) => {
    await page.goto('/');
    const container = page.locator('.hero-rot');

    // La clase la elige el nº de opciones (3 → hero-rot-3), y el ciclo completo
    // es rot-ms × n = 2000 × 3 = 6 s. Que la duración calculada sea la esperada
    // prueba que las custom properties inline llegan al motor de CSS.
    await expect(container).toHaveClass(/hero-rot-3/);
    const items = page.locator('.hero-rot-item');
    await expect(items.first()).toHaveCSS('animation-name', 'hero-rot-3');
    await expect(items.first()).toHaveCSS('animation-duration', '6s');
    // Cada opción entra desfasada su índice.
    await expect(items.nth(1)).toHaveCSS('animation-delay', '2s');
    await expect(items.nth(2)).toHaveCSS('animation-delay', '4s');

    // Sin salto de layout: las tres opciones ocupan la MISMA celda del grid, así
    // que la caja mide lo que la más ancha y no cambia al rotar.
    await expect(container).toHaveCSS('display', 'inline-grid');
    const cajas = await items.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    expect(new Set(cajas.map((c) => `${c.x}:${c.y}`)).size).toBe(1);
  });

  test('la opción visible cambia con el tiempo', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.hero-rot-item');

    const opacidades = () =>
      items.evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).opacity)));

    // Al principio del ciclo manda la primera opción.
    await expect(async () => {
      const [primera] = await opacidades();
      expect(primera).toBeGreaterThan(0.5);
    }).toPass({ timeout: 5_000 });

    // Y en algún momento del ciclo manda otra. Se sondea en vez de dormir un
    // tiempo fijo: el ciclo arranca cuando la página pinta, no cuando el test
    // navega, así que un sleep calculado sería intermitente.
    await expect(async () => {
      const valores = await opacidades();
      const dominante = valores.indexOf(Math.max(...valores));
      expect(dominante).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  });

  // ── 4. Movimiento reducido ─────────────────────────────────────────────────

  // La emulación se activa con page.emulateMedia() y NO con
  // `test.use({ reducedMotion })` en un describe anidado: se comprobó que ahí
  // no llega a la página (matchMedia devolvía false y la animación seguía
  // corriendo). Hacerlo en el test tiene además una ventaja real: permite
  // observar el MISMO documento con y sin la preferencia, que es lo que de
  // verdad demuestra que quien manda es la media query.
  test('prefers-reduced-motion apaga la animación y deja la primera opción — y solo la primera', async ({
    page,
  }) => {
    await page.goto('/');
    const items = page.locator('.hero-rot-item');

    // Punto de partida: la animación corre.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    await expect(items.first()).toHaveCSS('animation-name', 'hero-rot-3');

    // Con la preferencia puesta, sobre la MISMA página.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(items.first()).toHaveCSS('animation-name', 'none');

    const opacidades = await items.evaluateAll((els) =>
      els.map((el) => Number(getComputedStyle(el).opacity)),
    );
    // Exactamente lo que anuncia el lector de pantalla: ni más ni menos.
    expect(opacidades).toEqual([1, 0, 0]);

    // Y el titular sigue siendo una frase completa, no un texto mutilado.
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      `${STATIC_TITLE} ${OPTIONS[0]}`,
    );
  });
});

test.describe('Portada — hero sin opciones rotativas', () => {
  test.beforeAll(async ({ browser, request }) => {
    await setConfig(request, { ...DEFAULTS, heroStaticTitle: 'Solo texto fijo' });
    const warmup = await browser.newPage();
    // La espera comprueba las DOS cosas que el test va a afirmar —el título
    // nuevo y la ausencia del andamiaje— y no solo el título: si esperase solo
    // por el texto, podría seguir adelante con una respuesta a medio invalidar.
    await expect(async () => {
      await warmup.goto('/', { waitUntil: 'domcontentloaded' });
      const texto = await warmup.locator('h1').first().innerText();
      const andamiaje = await warmup.locator('.hero-rot').count();
      if (!texto.includes('Solo texto fijo') || andamiaje !== 0) {
        throw new Error(`la portada aún no refleja la config (h1="${texto}", .hero-rot=${andamiaje})`);
      }
    }).toPass({ timeout: 30_000 });
    await warmup.close();
  });

  test.afterAll(async ({ request }) => {
    await setConfig(request, DEFAULTS);
  });

  test('el <h1> se sirve igual, sin andamiaje de rotación', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Solo texto fijo');
    // N = 0 no emite el contenedor: un título estático no necesita andamiaje.
    await expect(page.locator('.hero-rot')).toHaveCount(0);
  });
});
