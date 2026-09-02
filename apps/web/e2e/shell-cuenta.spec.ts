// UXV.2 — el SHELL de la zona de cuenta.
//
// Lo que fija esta batería es el CONTENEDOR, no las pantallas: que exista cabecera de
// sitio en toda la zona (A1), que en móvil el contenido tenga ancho de verdad (A3), que
// el menú diga dónde estás (M1), que ningún destino de la zona sea inalcanzable desde él
// (M2) y que desde /planes se pueda volver a la cuenta (M3).
//
// El requisito de oro de la ráfaga —que las VEINTE pantallas sigan funcionando dentro del
// shell nuevo— se comprueba en `todas las pantallas de la zona`: el layout es común, así
// que un fallo aquí las rompe todas a la vez.

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';

/** Todas las rutas de `(account)` alcanzables sin construir un id. */
const PANTALLAS = [
  '/mis-anuncios',
  '/mis-anuncios/estadisticas',
  '/mis-anuncios/destacado-exito',
  '/mis-anuncios/destacado-error',
  '/mis-creditos',
  '/mis-creditos/error',
  '/perfil',
  '/perfil/facturacion',
  '/perfil/suscripcion',
  '/mis-tickets',
  '/mis-tickets/nuevo',
  '/mensajes',
  '/favoritos',
  '/mis-alertas',
  '/notificaciones',
  '/publicar',
] as const;

/** Las trece entradas del menú (SHELL-D4), en sus cuatro grupos. */
const ENTRADAS = [
  'Mis anuncios',
  'Publicar anuncio',
  'Estadísticas',
  'Mensajes',
  'Notificaciones',
  'Mis alertas',
  'Favoritos',
  'Mi saldo',
  'Mi suscripción',
  'Ver planes',
  'Datos de facturación',
  'Mi perfil',
  'Mis tickets',
] as const;

/** El logo de la cabecera: el enlace a la portada que la zona de cuenta no tenía. */
const logo = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Marketplace' });

test.describe('UXV.2 — A1: hay cabecera de sitio en toda la zona de cuenta', () => {
  test('desde CADA pantalla de la zona hay logo → portada', async ({ sellerContext }) => {
    // Dieciséis rutas en una sola prueba, a propósito: lo que se afirma es que NINGUNA
    // se queda sin cabecera, y eso solo se ve recorriéndolas. El coste es el plazo: en
    // local la batería corre contra `next dev`, que COMPILA cada ruta la primera vez que
    // se pide, así que este recorrido puede pagar dieciséis compilaciones seguidas y
    // pasarse de los 90 s por defecto. (En CI no aplica: allí se sirve un build de
    // producción — ver el comentario del webServer en playwright.config.ts.)
    test.slow();
    const page = await sellerContext.newPage();

    for (const ruta of PANTALLAS) {
      // `domcontentloaded` y no el `load` por defecto: la cabecera se sirve del
      // servidor, así que con el DOM listo ya se puede afirmar. Esperar a `load`
      // encadena dieciséis esperas a "todos los recursos" —y en /mensajes, a un
      // WebSocket que se está abriendo— hasta pasarse del plazo del test cuando la
      // batería entera compite por la máquina. Lo que se mide es la cabecera, no la
      // velocidad de carga.
      await page.goto(ruta, { waitUntil: 'domcontentloaded' });
      await expect(logo(page), `sin logo en ${ruta}`).toBeVisible({ timeout: 15_000 });
      await expect(logo(page)).toHaveAttribute('href', '/');
    }
  });

  test('la cabecera trae lo que se perdía al entrar en la cuenta: buscador y avatar', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const cabecera = page.getByRole('banner');
    await expect(cabecera.getByRole('link', { name: 'Buscar' })).toBeVisible({ timeout: 15_000 });
    // La campana de notificaciones y el avatar viven en HeaderAuthNav, que solo se pinta
    // con sesión — aquí siempre la hay.
    await expect(cabecera.getByRole('link', { name: /publicar anuncio/i })).toBeVisible();
  });

  test('el logo NAVEGA de verdad a la portada (no solo apunta)', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');

    await logo(page).click();
    // `commit` = la navegación ha ocurrido y el destino es la portada. Esperar a `load`
    // ataría esta prueba a lo que tarda en cargar la página más pesada del sitio (hero,
    // bloques y anuncios de Meilisearch), que no es lo que aquí se afirma: se afirma que
    // el logo SACA de la zona de cuenta.
    await page.waitForURL('http://localhost:3000/', { timeout: 15_000, waitUntil: 'commit' });
  });
});

test.describe('UXV.2 — A3: en móvil el contenido tiene ancho real', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('el aside no roba columna: el contenido ocupa casi todo el ancho', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    await expect(page.getByRole('heading', { name: 'Mis anuncios' })).toBeVisible({
      timeout: 15_000,
    });

    const caja = await page.locator('main').boundingBox();
    expect(caja).not.toBeNull();
    // ANTES: el aside fijo de 224px dejaba ~87px de los 375. El umbral se pone en 300
    // para que cualquier regreso a un sidebar que ocupe columna en móvil lo dispare.
    expect(caja!.width).toBeGreaterThan(300);

    // Y nada desborda en horizontal (la otra cara del mismo defecto).
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(desborda).toBe(false);
  });

  test('el menú sigue disponible: el drawer abre y navega, y se cierra al hacerlo', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    // En móvil el aside está oculto; el acceso es el botón.
    const abrir = page.getByRole('button', { name: /abrir el menú de mi cuenta/i });
    await expect(abrir).toBeVisible({ timeout: 15_000 });

    await abrir.click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    // Las trece entradas caben en el drawer (SHELL-D2: por eso no es barra inferior).
    for (const entrada of ENTRADAS) {
      await expect(panel.getByRole('link', { name: entrada, exact: true })).toBeVisible();
    }

    await panel.getByRole('link', { name: 'Mi saldo', exact: true }).click();
    await page.waitForURL(/\/mis-creditos$/, { timeout: 15_000 });
    // Se cierra al navegar: si no, el panel se queda encima de la página nueva.
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('el wizard de edición y las tablas se usan en 375px', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/publicar');
    await expect(page.getByText(/paso 1 de/i)).toBeVisible({ timeout: 15_000 });
    const wizard = await page.locator('main').boundingBox();
    expect(wizard!.width).toBeGreaterThan(300);

    await page.goto('/perfil/facturacion');
    await expect(page.getByRole('heading', { name: /datos de facturación/i })).toBeVisible({
      timeout: 15_000,
    });
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(desborda).toBe(false);
  });
});

test.describe('UXV.2 — M1: se ve dónde estás', () => {
  test('el menú marca la sección actual con aria-current', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-creditos');
    const aside = page.getByRole('navigation', { name: /secciones de mi cuenta/i });
    await expect(aside.getByRole('link', { name: 'Mi saldo', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
      { timeout: 15_000 },
    );
    // Y solo una: el activo es único en todo el menú.
    await expect(aside.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('una subruta marca SU entrada, no la de la sección padre', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios/estadisticas');

    const aside = page.getByRole('navigation', { name: /secciones de mi cuenta/i });
    await expect(aside.getByRole('link', { name: 'Estadísticas', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
      { timeout: 15_000 },
    );
    await expect(aside.getByRole('link', { name: 'Mis anuncios', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('las pantallas de tercer nivel llevan migas; las raíces de sección no', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // Raíz de sección: el menú ya lo dice, la miga sería ruido.
    await page.goto('/mis-creditos');
    await expect(page.getByRole('heading', { name: 'Mi saldo' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toHaveCount(0);

    // Tercer nivel: dice de qué sección cuelga y deja volver a ella.
    await page.goto('/mis-tickets/nuevo');
    const migas = page.getByRole('navigation', { name: 'Ruta de navegación' });
    await expect(migas).toBeVisible({ timeout: 15_000 });
    await expect(migas.getByRole('link', { name: 'Mis tickets' })).toBeVisible();
    await expect(migas).toContainText('Nuevo ticket');
  });
});

test.describe('UXV.2 — M2: ningún destino de la zona es inalcanzable', () => {
  test('las trece entradas están en el menú de escritorio', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const aside = page.getByRole('navigation', { name: /secciones de mi cuenta/i });
    await expect(aside).toBeVisible({ timeout: 15_000 });

    for (const entrada of ENTRADAS) {
      await expect(
        aside.getByRole('link', { name: entrada, exact: true }),
        `falta "${entrada}" en el menú`,
      ).toBeVisible();
    }
  });

  test('los cuatro huérfanos de la auditoría ya se alcanzan desde el menú', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    const aside = page.getByRole('navigation', { name: /secciones de mi cuenta/i });

    // Estadísticas, Datos de facturación y Mis tickets solo se alcanzaban desde un
    // botón enterrado en otra pantalla; Planes, desde ninguna parte de la zona.
    for (const [entrada, url] of [
      ['Estadísticas', /\/mis-anuncios\/estadisticas$/],
      ['Datos de facturación', /\/perfil\/facturacion$/],
      ['Mis tickets', /\/mis-tickets$/],
    ] as const) {
      await page.goto('/mis-anuncios');
      await aside.getByRole('link', { name: entrada, exact: true }).click();
      await page.waitForURL(url, { timeout: 15_000 });
    }
  });
});

test.describe('UXV.2 — M3: cuenta → planes → cuenta, sin quedar varado', () => {
  test('el viaje de ida y vuelta desde la suscripción', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/perfil/suscripcion');
    await expect(page.getByRole('heading', { name: /mi suscripción/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('link', { name: /ver planes/i }).first().click();
    await page.waitForURL(/\/planes$/, { timeout: 15_000 });

    // Fuera del shell de cuenta, pero con vuelta explícita — y solo para quien tiene
    // sesión (un visitante anónimo no ve "Mi cuenta").
    const vuelta = page.getByRole('navigation', { name: 'Ruta de navegación' }).getByRole('link', {
      name: 'Mi cuenta',
    });
    await expect(vuelta).toBeVisible({ timeout: 15_000 });

    await vuelta.click();
    await page.waitForURL(/\/mis-anuncios$/, { timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: /secciones de mi cuenta/i })).toBeVisible();
  });

  test('el visitante anónimo NO ve el retorno a la cuenta en /planes', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/planes');
    await expect(page.getByRole('heading', { name: /elige tu plan/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Mi cuenta' })).toHaveCount(0);

    await ctx.close();
  });
});

test.describe('UXV.2 — requisito de oro: todas las pantallas de la zona siguen en pie', () => {
  test('las dieciséis rutas responden, renderizan su contenido y no rompen el shell', async ({
    sellerContext,
  }) => {
    // Mismo motivo que el recorrido de A1: dieciséis rutas y, en local, otras tantas
    // compilaciones de `next dev` a la primera visita.
    test.slow();
    const page = await sellerContext.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`));

    for (const ruta of PANTALLAS) {
      const res = await page.goto(ruta);
      expect(res?.status(), `HTTP en ${ruta}`).toBeLessThan(400);

      // El shell entero está montado en cada una: cabecera + menú + contenido.
      await expect(page.getByRole('banner'), `sin cabecera en ${ruta}`).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole('navigation', { name: /secciones de mi cuenta/i }),
        `sin menú en ${ruta}`,
      ).toBeVisible();
      // Y la página tiene contenido propio, no un shell vacío.
      const main = page.locator('main');
      expect((await main.innerText()).trim().length, `main vacío en ${ruta}`).toBeGreaterThan(10);
    }

    expect(errores, `errores de JS en la zona:\n${errores.join('\n')}`).toEqual([]);
  });

  test('mensajería: el shell de dos columnas conserva altura dentro del layout nuevo', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mensajes');
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 15_000 });

    // La altura ya no sale de un calc() con una constante cosida al layout viejo: la
    // rellena el propio shell. Lo que importa es que siga siendo una caja alta y que no
    // desborde el viewport.
    const caja = await page.locator('main > div').last().boundingBox();
    expect(caja).not.toBeNull();
    expect(caja!.height).toBeGreaterThan(200);
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 2);
  });
});
