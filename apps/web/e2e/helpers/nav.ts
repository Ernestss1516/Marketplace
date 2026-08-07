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
 *
 * ── Dos wedges distintos, y por eso dos mitigaciones ────────────────────────
 *
 * **Wedge RECUPERABLE — lo cubre el reclic, y es la mayoría.** Medido en
 * `nav-publico` tras migrarlo: 10 corridas aisladas → 7 conmutaron al primer
 * clic y 3 al segundo (se ve en los tiempos: ~0,6 s frente a ~5,7 s). El spec
 * entero repetido 10 veces, 50/50 verde.
 *
 * **Wedge PERSISTENTE — el reclic NO basta.** Bajo la carga de la batería
 * completa se han visto los SEIS intentos (30 s / 5 s) agotarse sobre la misma
 * página: una vez el router cliente entra en ese estado, clicar otra vez sobre
 * ESE MISMO documento no lo saca. De ahí `recargarEntreIntentos`.
 *
 * ── `recargarEntreIntentos` — qué hace y cuándo encenderlo ──────────────────
 *
 * Con la bandera puesta, cada reintento **recarga la página antes de volver a
 * clicar**, con la idea de que un documento nuevo trae un router nuevo.
 *
 * MEDIDO, y con un matiz que importa: la recarga **sí recupera** —se ha visto
 * imprimir `recuperado tras 1 recarga(s)` en una corrida real— pero **no salva
 * el wedge persistente**: en una batería completa se agotaron los reintentos
 * con recargas y ninguna sirvió. O sea que la bandera es una red útil, no la
 * cura. La cura es atacar la causa, y eso es `prefetch={false}` en el `<Link>`
 * (cambio de producto, ya aplicado en el nav — ver MainNav.tsx).
 *
 * **Enciéndela** cuando el clic dependa SOLO de lo que pinta el servidor: un
 * enlace de una barra de navegación, de un listado, de una ficha. Recargar no
 * pierde nada porque no hay nada que perder.
 *
 * **NO la enciendas** cuando el test haya construido estado de cliente antes del
 * clic — texto tecleado, una opción seleccionada, un panel abierto. La recarga
 * lo vacía y el reintento actuaría en blanco. Caso real: en `portada-bloques` el
 * clic sobre "Buscar" viene después de teclear "bicicleta" en el input; con la
 * bandera puesta, el segundo intento buscaría con la consulta vacía y el test
 * pasaría a afirmar algo que no es. Por eso va **apagada por defecto**.
 *
 * ── La recarga se LOGUEA, y eso es parte del trato ──────────────────────────
 *
 * Tolerar un bug ajeno (Next #57565, sin fix upstream) solo es aceptable si la
 * tolerancia es VISIBLE. Cada recuperación imprime una línea
 * `[clicarYEsperarUrl] recuperado tras N recarga(s)`, molde de
 * `[waitForCard] found after N reload(s)`. Así "el test pasa" se lee siempre
 * como "pasó, y recargó N veces": si el wedge pasa de ocasional a constante, el
 * log lo delata —recargas en todas las corridas— en vez de un verde mudo que
 * esconde un router roto.
 */
export async function clicarYEsperarUrl(
  page: Page,
  chip: Locator,
  urlEsperada: (url: URL) => boolean,
  {
    timeout = 30_000,
    porIntento = 5_000,
    recargarEntreIntentos = false,
  }: { timeout?: number; porIntento?: number; recargarEntreIntentos?: boolean } = {},
): Promise<void> {
  let recargas = 0;

  await expect(async () => {
    await chip.click();
    // Plazo CORTO por intento: si el router se ha quedado wedged, esperar más no
    // lo despierta — lo que hace falta es salir y repetir el clic.
    try {
      await page.waitForURL(urlEsperada, { waitUntil: 'commit', timeout: porIntento });
    } catch (e) {
      // Antes de que `toPass` reintente: si la bandera está puesta, se recarga
      // aquí, de modo que el próximo clic caiga sobre un documento nuevo.
      if (recargarEntreIntentos) {
        recargas++;
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
      throw e;
    }
  }).toPass({ timeout });

  // Solo se imprime cuando ha hecho falta: un verde normal no ensucia la salida,
  // y un verde que necesitó recargas queda registrado. Ver el docblock.
  if (recargas > 0) {
    console.log(`[clicarYEsperarUrl] recuperado tras ${recargas} recarga(s)`);
  }
}
