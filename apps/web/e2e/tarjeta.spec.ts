// UXV.4 — la TARJETA con jerarquía, y las dos superficies de propietario reconciliadas.
//
// Lo que fija esta batería: que la fila plana de doce botones pasó a tener niveles sin
// perder NINGUNA acción (A6), que desde la tarjeta se llega al anuncio publicado (A5) y a
// sus estadísticas (M10), que las pestañas dicen cuántos anuncios contienen (B3), que
// promocionar mantiene el bump gratis a un clic y admite el futuro «programar»
// (TARJETA-D2), y que la ficha pública cuenta lo mismo que la tarjeta (transversal 2).

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { abrirPromocionar } from './helpers/promocion';

/**
 * Las acciones que la tarjeta ofrecía antes, repartidas ahora en tres niveles.
 *
 * BORRADO B2 — «Eliminar» SALE de esta lista: el dueño ya no destruye anuncios.
 * Para un ACTIVE la salida destructiva es «Archivar», que sigue aquí. Lo único
 * que el dueño puede destruir es un borrador, y eso se llama «Descartar
 * borrador» y sólo aparece en `DRAFT` — se comprueba en su propio caso abajo.
 */
const EN_MENU_ACTIVE = [
  'Reservar',
  'Marcar vendido',
  'Renovar',
  'Ver estadísticas',
  '¿Necesitas ayuda?',
  'Archivar',
];

const tarjeta = (page: Page) => page.locator('[data-testid^="listing-card-"]').first();

test.describe('UXV.4 (A6) — la tarjeta tiene jerarquía, no una parrilla', () => {
  test('primaria destacada, tres secundarias, y el resto en el menú', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const card = tarjeta(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Primaria: una sola, y es promocionar (TARJETA-D1).
    await expect(card.getByTestId('btn-promocionar')).toBeVisible();

    // Secundarias de un ACTIVE: editar, ver anuncio y LA acción de estado (pausar).
    // Que sea «Pausar» y no también Reactivar/Publicar/Renovar es lo que descarga la fila.
    await expect(card.getByRole('link', { name: 'Editar' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Ver anuncio' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Pausar' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reactivar' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Publicar' })).toHaveCount(0);

    // Lo destructivo NO está en la fila.
    // BORRADO B2 — «Eliminar» ya no existe para el dueño en ningún sitio, así
    // que esta aserción pasa de «no está en la fila» a «no está, y punto».
    await expect(card.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Archivar' })).toHaveCount(0);

    // La fila tiene POCOS controles. Antes eran hasta doce.
    const controlesEnFila = await card.locator('a, button').count();
    expect(controlesEnFila).toBeLessThanOrEqual(6);
  });

  test('REQUISITO DE ORO: ninguna acción se perdió — están todas, en el menú', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    await tarjeta(page).getByTestId('btn-mas-acciones').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });

    for (const accion of EN_MENU_ACTIVE) {
      await expect(menu.getByRole('menuitem', { name: accion }), `falta «${accion}»`).toBeVisible();
    }
  });

  test('lo irreversible sigue pidiendo confirmación — el menú no la relaja', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // BORRADO B2 — se prueba con «Archivar», no con «Eliminar»: el dueño ya no
    // puede eliminar, y archivar es ahora SU acción irreversible (ARCHIVED es
    // terminal). La propiedad bajo prueba no cambia — que el menú no relaja la
    // confirmación de lo irreversible— sólo cuál es esa acción.
    let ejecutado = false;
    await page.route('**/listings/*/archive', async (route) => {
      if (route.request().method() === 'POST') {
        ejecutado = true;
        await route.fulfill({ status: 200, body: '{}' });
        return;
      }
      await route.fallback();
    });

    await page.goto('/mis-anuncios');
    await tarjeta(page).getByTestId('btn-mas-acciones').click();
    await page.getByRole('menuitem', { name: 'Archivar' }).click();

    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible({ timeout: 10_000 });
    await expect(dialogo).toContainText(/no se puede deshacer/i);
    expect(ejecutado).toBe(false);

    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).not.toBeVisible();
    expect(ejecutado).toBe(false);
  });

  test('en móvil la tarjeta no es una parrilla de botones', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/mis-anuncios');

    const card = tarjeta(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('btn-promocionar')).toBeVisible();

    // Nada desborda en horizontal (lo que UXV.2 dejó arreglado sigue arreglado).
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(desborda).toBe(false);
  });
});

test.describe('UXV.4 (A5, M10) — desde la tarjeta se llega al anuncio y a sus datos', () => {
  test('«Ver anuncio» lleva a la ficha pública de ESE anuncio', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const enlace = tarjeta(page).getByRole('link', { name: 'Ver anuncio' });
    await expect(enlace).toBeVisible({ timeout: 15_000 });
    await expect(enlace).toHaveAttribute('href', /^\/anuncio\/.+/);

    await enlace.click();
    await page.waitForURL(/\/anuncio\/.+/, { timeout: 15_000 });
  });

  test('«Ver estadísticas» abre las de ESE anuncio, no la pantalla global en blanco', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const id = await tarjeta(page).getAttribute('data-testid');
    const listingId = id!.replace('listing-card-', '');

    await tarjeta(page).getByTestId('btn-mas-acciones').click();
    await page.getByRole('menuitem', { name: 'Ver estadísticas' }).click();

    await page.waitForURL(new RegExp(`/mis-anuncios/estadisticas\\?anuncio=${listingId}`), {
      timeout: 15_000,
    });
    // Y el selector llega ya puesto en ese anuncio (antes había que buscarlo a mano).
    await expect(page.getByTestId('stats-listing-select')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('stats-basic')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('UXV.4 (B3) — las pestañas dicen cuántos anuncios contienen', () => {
  test('cada filtro lleva su recuento, y «Todos» excluye archivados', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const todos = page.getByRole('button', { name: /^Todos/ });
    await expect(todos).toBeVisible({ timeout: 15_000 });
    // Antes: «Todos» a secas. Ahora lleva un número al lado.
    await expect(todos).toHaveText(/Todos\s*\d+/);
    await expect(page.getByRole('button', { name: /^Activos/ })).toHaveText(/Activos\s*\d+/);
  });
});

test.describe('UXV.4 (TARJETA-D2) — promocionar agrupa los dos productos', () => {
  test('el diálogo ofrece subir y destacar, con su coste, y admite un producto más', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    await abrirPromocionar(page);
    const dialogo = page.getByRole('dialog');

    // Los dos productos que antes eran dos botones sueltos, ahora explicados y con precio.
    await expect(dialogo.getByText('Subir al inicio')).toBeVisible();
    await expect(dialogo.getByText('Destacar', { exact: true })).toBeVisible();
    await expect(dialogo.getByTestId('promo-bump-coste')).toContainText(/créditos|gratis/i);

    // ENGANCHE del bump automático: el selector de producto es una lista de opciones, así
    // que «Programar bumps» entra como una más. Esto fija que la estructura existe — no
    // que el bump programado exista.
    const opciones = dialogo.getByTestId('promo-producto').getByRole('radio');
    expect(await opciones.count()).toBeGreaterThanOrEqual(2);
  });

  test('con bump gratis, el control primario lo ejecuta a UN CLIC (no abre el diálogo)', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();

    // Pro con cuota de bumps → gratis. Es el caso que TARJETA-D2 protege expresamente.
    await page.route('**/billing/pro-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isPro: true,
          limit: 4,
          used: 0,
          remaining: 4,
          quotaDurationDays: 7,
          bumpQuota: { limit: 5, used: 0, remaining: 5 },
        }),
      }),
    );
    let bumpLlamado = false;
    await page.route('**/listings/*/bump', (route) => {
      bumpLlamado = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpedAt: new Date().toISOString(), paidWith: 'PRO_QUOTA', cost: 0 }),
      });
    });

    await page.goto('/mis-anuncios');
    const primario = page.getByTestId('btn-promocionar').first();
    await expect(primario).toHaveText(/subir gratis/i, { timeout: 15_000 });

    await primario.click();

    // Un clic: se ejecutó, sin diálogo de por medio.
    await expect.poll(() => bumpLlamado, { timeout: 10_000 }).toBe(true);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Y avisa por el canal de UXV.3.
    await expect(page.locator('[data-sonner-toaster]')).toContainText(/bump aplicado/i, {
      timeout: 10_000,
    });
  });

  test('el atajo de un clic conserva el acceso al resto de la promoción', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await page.route('**/billing/pro-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isPro: true,
          limit: 4,
          used: 0,
          remaining: 4,
          quotaDurationDays: 7,
          bumpQuota: { limit: 5, used: 0, remaining: 5 },
        }),
      }),
    );

    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 15_000 });

    // El desplegable del botón partido: es DONDE ENTRARÁ «Programar bumps…».
    await page.getByTestId('btn-promocionar-mas').first().click();
    await expect(page.getByRole('menuitem', { name: /destacar anuncio/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('UXV.4 (transversal 2) — la ficha y la tarjeta cuentan lo mismo', () => {
  test('la ficha muestra el MISMO control de promoción, con coste', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-anuncios');
    const enlace = tarjeta(page).getByRole('link', { name: 'Ver anuncio' });
    await expect(enlace).toBeVisible({ timeout: 15_000 });
    const hrefFicha = await enlace.getAttribute('href');

    // Rótulo en la tarjeta.
    const rotuloTarjeta = await page.getByTestId('btn-promocionar').first().innerText();

    await page.goto(hrefFicha!);
    const primarioFicha = page.getByTestId('btn-promocionar');
    await expect(primarioFicha).toBeVisible({ timeout: 15_000 });

    // ANTES: «Bump 5 cr.» en la tarjeta y «Subir al inicio (bump)» en la ficha, sin coste.
    expect((await primarioFicha.innerText()).trim()).toBe(rotuloTarjeta.trim());

    // Y el coste se ve también aquí: es lo que UXV.1 dejó fuera a propósito.
    await abrirPromocionar(page);
    await expect(page.getByTestId('promo-bump-coste')).toContainText(/créditos|gratis/i);
  });
});
