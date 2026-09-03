import type { Page } from '@playwright/test';

/**
 * E0 — LO QUE SE APAGA ANTES DE DISPARAR.
 *
 * Una batería visual sólo vale si su rojo SIEMPRE significa algo. Una captura que
 * coincide unas veces sí y otras no acaba ignorada, y entonces no es una red: es ruido
 * con coste de CI. Así que todo lo que pueda mover un píxel sin que nadie haya cambiado
 * nada se apaga aquí, en UN sitio, para las ~46 capturas.
 *
 * Las cuatro fuentes de ruido de este repo, y qué hace cada línea:
 *
 *  1. MOVIMIENTO. 156 `animate-spin`, 22 `animate-pulse`, la rotación del hero y el
 *     sprite del póster. `animations: 'disabled'` (en la config) congela animaciones y
 *     transiciones; `prefers-reduced-motion` es la SEGUNDA defensa y no es redundante:
 *     es la que el CSS propio del repo ya sabe respetar, y lleva al hero y al sprite a su
 *     estado degradado —que está diseñado para ser completo, no mutilado—, en vez de a un
 *     fotograma cualquiera del ciclo.
 *
 *  2. TIPOGRAFÍA. Inter se sirve LOCAL desde el repo (`next/font/local`), así que no
 *     depende de la red y ya es determinista; lo que falta es esperar a que esté aplicada
 *     antes de disparar, o la captura sale con la fuente de respaldo y con otras métricas.
 *
 *  3. CARGA DIFERIDA. Casi todas las imágenes son `lazy`. En una captura de página
 *     completa, las que están bajo el pliegue no han empezado a cargar cuando Playwright
 *     dispara: saldrían como huecos, y como huecos INTERMITENTES. Se recorre la página
 *     entera para dispararlas y se vuelve arriba.
 *
 *  4. RED. `networkidle` sin plazo es la causa conocida de cuelgues en este repo (ver el
 *     comentario de `actionTimeout` en playwright.config.ts). Aquí se usa con plazo
 *     propio y se tolera que venza: si algo mantiene la red viva, es mejor disparar que
 *     colgar el test.
 */
export async function preparar(page: Page, ruta: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(ruta);
  await page.waitForLoadState('domcontentloaded');

  // Recorre la página para disparar la carga diferida y vuelve al principio. El
  // `scrollTo(0, 0)` final importa: sin él la captura de viewport saldría del sitio
  // equivocado, y la de página completa arrancaría con posiciones `sticky` resueltas de
  // otra manera.
  await page.evaluate(async () => {
    const paso = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += paso) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });

  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

  // Fuentes aplicadas e imágenes decodificadas. `decode()` sobre una imagen ya rota
  // rechaza, y una imagen rota es un estado legítimo de una pantalla: se ignora el
  // rechazo para no convertir en error lo que sólo es un hueco que también hay que
  // fotografiar.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => img.decode().catch(() => undefined)),
    );
  });
}
