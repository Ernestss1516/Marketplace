import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Clic sobre un `<Link>` del App Router + espera de la URL, con REINTENTO DEL
 * CLIC — el único mitigador que funciona contra la carrera del router (familia
 * 2b).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Bajo `next start` (nunca bajo `next dev`) un clic sobre un `<Link>` a veces no
 * completa la transición: la RSC payload responde 200 en <10 ms y el router NO
 * conmuta. No es una ventana transitoria — la página queda con el router cliente
 * **persistentemente wedged**, así que esperar más NO sirve (medido en la ráfaga
 * D: subir `navigationTimeout` no arregló ni uno). Bug conocido de Next 15,
 * firma de `vercel/next.js#57565`, sin fix upstream; mitigado a nivel de producto
 * con `prefetch={false}` en las tarjetas (53 % → 20 %). Ver la investigación de 5
 * rondas en `estado-tecnico.md`.
 *
 * Lo único que recupera el estado es **volver a hacer el clic**, no volver a
 * esperar. Eso es lo que hace `toPass` aquí: cada reintento repite el clic
 * entero, no solo la espera.
 *
 * `busqueda-mapa` y `flujo-critico` ya lo usaban en línea; los 3 flaky de la
 * última corrida completa son exactamente eso — 2b **rescatado por el retry**. Los
 * specs que hacían `click()` + `waitForURL()` a pelo salían en cambio como rojos
 * duros. Este helper unifica el patrón en un sitio.
 *
 * NO subir `navigationTimeout` como alternativa: está demostrado que no ayuda.
 */
export async function clicarYEsperarUrl(
  page: Page,
  chip: Locator,
  urlEsperada: (url: URL) => boolean,
  { timeout = 30_000, porIntento = 5_000 }: { timeout?: number; porIntento?: number } = {},
): Promise<void> {
  await expect(async () => {
    await chip.click();
    // Plazo CORTO por intento: si el router se ha quedado wedged, esperar más no
    // lo despierta — lo que hace falta es salir y repetir el clic.
    await page.waitForURL(urlEsperada, { waitUntil: 'commit', timeout: porIntento });
  }).toPass({ timeout });
}
