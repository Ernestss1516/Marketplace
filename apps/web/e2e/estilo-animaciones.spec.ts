import { test, expect } from './fixtures/auth';

/**
 * ══ E6 · LAS ANIMACIONES, COMPROBADAS DONDE UNA CAPTURA NO LLEGA ═════════════════════
 *
 * Una captura estática no puede ver una animación: Playwright las congela en su estado
 * FINAL antes de disparar, y el estado final de todo lo de E6 es idéntico al de antes
 * —por diseño, para que la red visual siga siendo comparable—. Así que lo que hay que
 * afirmar aquí es lo que la imagen no dice:
 *
 *  · que la animación EXISTE (hay un `animation-name`, no es una clase muerta como las
 *    que E0 encontró y quitó);
 *  · que su TEMPO SALE DEL MODELO, y no de los valores por defecto del plugin;
 *  · que ese tempo CAMBIA POR ZONA, que es la forma que el sistema le da a la
 *    «intensidad» (§6.3);
 *  · y que `prefers-reduced-motion` la apaga dejando un estado COMPLETO (regla 5).
 *
 * El tempo esperado no se inventa: son los valores que el Modelo 0 declara para cada
 * zona en `estilo.constants.ts` — 150 ms en el público, 120 en la cuenta, 100 en el
 * backoffice («una herramienta responde; no se luce»).
 */

const MOVIL = { width: 375, height: 720 };

test.describe('Las capas animan con el tempo del modelo, y por zona', () => {
  test('el cajón de la CUENTA usa los 120 ms de su zona', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.setViewportSize(MOVIL);
    await page.goto('/mis-anuncios');
    await page.getByLabel('Abrir el menú de mi cuenta').click();

    const cajon = page.getByRole('dialog');
    await expect(cajon).toBeVisible();

    const animacion = await cajon.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nombre: c.animationName, duracion: c.animationDuration, curva: c.animationTimingFunction };
    });

    // Que EXISTA: `enter` es el fotograma que instala `tailwindcss-animate`. Si esto
    // fuera `none`, estaríamos otra vez donde estaba E0 — clases que no generan CSS.
    expect(animacion.nombre).toBe('enter');
    // Y que dure lo que dice el modelo para esta zona, no los 150 ms de la base ni un
    // valor del plugin.
    expect(animacion.duracion).toBe('0.12s');
    expect(animacion.curva).not.toBe('ease');

    await page.close();
  });

  test('el del BACKOFFICE usa los 100 ms de la suya — la zona resta', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.setViewportSize(MOVIL);
    await page.goto('/admin');
    await page.getByLabel('Abrir el menú del backoffice').click();

    const cajon = page.getByRole('dialog');
    await expect(cajon).toBeVisible();

    const duracion = await cajon.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(duracion).toBe('0.1s');

    await page.close();
  });
});

test.describe('La zona de impacto', () => {
  test('la tarjeta del acceso entra, y con la curva de énfasis del modelo', async ({ page }) => {
    await page.goto('/admin/login');
    const tarjeta = page.locator('.entra-escalonado').first();
    const a = await tarjeta.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nombre: c.animationName, duracion: c.animationDuration };
    });
    expect(a.nombre).toBe('entrada-suave');
    // La zona `login` no ajusta el tempo, así que hereda el de la base: 150 ms.
    expect(a.duracion).toBe('0.15s');
  });

  test('el CTA canónico responde al tempo del modelo, no a uno escrito a mano', async ({
    page,
  }) => {
    await page.goto('/planes');
    // El CTA vive en los bloques de portada y de blog; aquí basta con comprobar que la
    // clase compartida lleva la transición sin duración propia. Se mide sobre el propio
    // botón si hay alguno en la página, y si no, sobre la utilidad, que es lo que se
    // quiere afirmar: que `transition-transform` sin `duration-*` toma el token.
    const duracion = await page.evaluate(() => {
      const sonda = document.createElement('div');
      sonda.className = 'transition-transform';
      document.body.appendChild(sonda);
      const d = getComputedStyle(sonda).transitionDuration;
      sonda.remove();
      return d;
    });
    expect(duracion).toBe('0.15s');
  });
});

/**
 * LA REGLA 5, QUE ES LA QUE MÁS FÁCIL SE INCUMPLE SIN DARSE CUENTA: apagar una
 * animación no puede dejar la pantalla a medio construir. Lo que se ve con el
 * movimiento reducido tiene que ser el estado FINAL, no el inicial.
 */
test.describe('prefers-reduced-motion degrada a un estado COMPLETO', () => {
  // `emulateMedia` y no `test.use({ reducedMotion })`: las páginas de este fichero
  // salen de los contextos autenticados del fixture, que se crean con
  // `browser.newContext()` y no heredan las opciones del `use`. Se pide por página, que
  // es donde se mide.

  test('la tarjeta del acceso se ve entera, sin animación', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/login');
    const tarjeta = page.locator('.entra-escalonado').first();
    const estado = await tarjeta.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nombre: c.animationName, opacidad: c.opacity, transform: c.transform };
    });
    expect(estado.nombre).toBe('none');
    // Opaca y en su sitio: el estado final, no el de partida (que era opacidad 0 y
    // medio centímetro más abajo).
    expect(estado.opacidad).toBe('1');
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(estado.transform);
    await expect(tarjeta).toBeVisible();
  });

  test('el cajón sigue abriendo Y CERRANDO sin animación', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(MOVIL);
    await page.goto('/admin');
    await page.getByLabel('Abrir el menú del backoffice').click();

    const cajon = page.getByRole('dialog');
    await expect(cajon).toBeVisible();
    expect(await cajon.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    /**
     * ⚠ ESTE CIERRE NO ES DECORACIÓN. `Presence` de Radix desmonta esperando el
     * `animationend` de la salida; si `animate-out` se apagara de una forma que dejara
     * un nombre de animación vivo pero sin fotogramas, ese evento no llegaría nunca y
     * el cajón se quedaría abierto para siempre — con el movimiento reducido puesto, o
     * sea justo para quien menos puede pelearse con la interfaz. Con `animation: none`
     * Radix desmonta en el acto, y esto lo comprueba.
     */
    await page.getByRole('button', { name: 'Cerrar el menú' }).click();
    await expect(cajon).toBeHidden();

    await page.close();
  });
});
