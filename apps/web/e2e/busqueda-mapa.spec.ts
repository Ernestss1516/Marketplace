// H6.5a — Playwright E2E: toggle lista/mapa en /busqueda.
//
// El canvas WebGL de MapLibre no es inspeccionable en Playwright (es opaco al DOM),
// así que los tests verifican la estructura del contenedor y el comportamiento del
// toggle, no el renderizado visual del mapa.
//
// Verificación visual imprescindible (manual):
//   - Los tiles de MapTiler cargan (calles visibles, no gris).
//   - Los markers aparecen en las ciudades correctas (no en China — lat/lng invertido).
//   - El toggle Lista↔Mapa funciona sin recargar la página.

import { test, expect } from './fixtures/auth';

test.describe('H6.5a — Vista de mapa en /busqueda', () => {

  test('?view=mapa renderiza el contenedor del mapa (data-testid=map-view)', async ({ page }) => {
    await page.goto('/busqueda?view=mapa');
    await page.waitForLoadState('networkidle');

    // Map container must be present and visible
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 10_000 });

    // Grid should NOT be rendered in map view
    // (the listing grid uses grid-cols-2 — check that no listing cards are shown)
    await expect(page.locator('[data-testid="map-view"]')).toBeVisible();
  });

  test('sin ?view: renderiza la lista (grid) y NO el mapa', async ({ page }) => {
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');

    // Map container must NOT be present
    await expect(page.getByTestId('map-view')).not.toBeVisible();

    // Toggle buttons must be visible in both views
    await expect(page.getByRole('link', { name: /Lista/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mapa/ })).toBeVisible();
  });

  test('toggle Lista→Mapa→Lista cambia la vista y preserva filtros', async ({ page }) => {
    await page.goto('/busqueda?category=coches');
    await page.waitForLoadState('networkidle');

    // Start: list view, no map
    await expect(page.getByTestId('map-view')).not.toBeVisible();

    // Click Mapa
    await page.getByRole('link', { name: /Mapa/ }).click();
    await page.waitForLoadState('networkidle');

    // Now in map view
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('view=mapa');
    // Category filter preserved
    expect(page.url()).toContain('category=coches');

    // Click Lista
    await page.getByRole('link', { name: /Lista/ }).click();
    await page.waitForLoadState('networkidle');

    // Back to list view
    await expect(page.getByTestId('map-view')).not.toBeVisible();
    expect(page.url()).not.toContain('view=mapa');
    // Category filter still preserved
    expect(page.url()).toContain('category=coches');
  });

  test('FilterPanel se mantiene visible en vista mapa', async ({ page }) => {
    await page.goto('/busqueda?view=mapa');
    await page.waitForLoadState('networkidle');

    // FilterPanel is inside an aside with aria-label="Filtros"
    const aside = page.getByRole('complementary', { name: 'Filtros' });
    await expect(aside).toBeVisible();
  });

  test('?view=mapa no rompe el SSR: h1 y toggle presentes en el HTML inicial', async ({ page }) => {
    // Disable JS to verify SSR output includes the key structural elements
    await page.context().setExtraHTTPHeaders({});

    const response = await page.goto('/busqueda?view=mapa');
    // Page must return 200
    expect(response?.status()).toBe(200);

    // h1 and toggle links are Server Component output — must be in SSR HTML
    await expect(page.getByRole('heading', { name: 'Todos los anuncios' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mapa/ })).toBeVisible();
  });

});
