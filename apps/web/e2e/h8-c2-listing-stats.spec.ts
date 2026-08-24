// H8 Bloque C2 — Playwright E2E: UI de estadísticas de anuncios (vistas + me gusta).
//
// listing-rf11-e2e pertenece a seller-e2e@example.com (no-Pro).
// listing-pro-e2e pertenece a pro-e2e@example.com (Pro — Subscription + Entitlement
// PRO_SUBSCRIPTION activos, seed-playwright.ts).
//
// Estos son tests ESTRUCTURALES: no dependen de cifras exactas (los contadores reales
// se acumulan entre ejecuciones de CI), solo de que los elementos correctos aparezcan
// para cada tipo de usuario. El comportamiento numérico (dedup, exclusión del dueño,
// gating Pro) ya está cubierto por la batería e2e del backend (h8-c1-listing-stats).

import { test, expect } from './fixtures/auth';

test.describe('Tracking de vista desde la ficha', () => {
  test('al abrir una ficha se dispara POST /listings/:slug/view', async ({ buyerContext }) => {
    const page = await buyerContext.newPage();

    const viewRequest = page.waitForRequest(
      (req) => req.url().includes('/listings/listing-rf11-e2e/view') && req.method() === 'POST',
    );

    await page.goto('/anuncio/listing-rf11-e2e');
    await expect(viewRequest).resolves.toBeTruthy();
  });
});

test.describe('/mis-anuncios — cifras básicas', () => {
  test('cada card propia muestra vistas y me gusta', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    await page.waitForLoadState('networkidle');

    const stats = page.getByTestId('listing-stats-basic').first();
    await expect(stats).toBeVisible({ timeout: 10_000 });
    await expect(stats).toContainText('vista');
    await expect(stats).toContainText('me gusta');
  });

  test('enlace a la página de estadísticas visible desde /mis-anuncios', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    await expect(page.getByRole('link', { name: 'Ver estadísticas' })).toBeVisible();
  });
});

test.describe('/mis-anuncios/estadisticas — gating Pro vs free', () => {
  test('usuario FREE ve el selector, las cifras básicas y el CTA de upgrade — sin gráfica', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios/estadisticas');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('stats-listing-select')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('stats-basic')).toBeVisible();
    await expect(page.getByTestId('stats-upgrade-cta')).toBeVisible();
    await expect(page.getByTestId('stats-upgrade-cta')).toContainText('Pro');

    await expect(page.getByTestId('stats-chart')).not.toBeVisible();
    await expect(page.getByTestId('stats-summary')).not.toBeVisible();

    // A2 — «veces listado» y el CTR son Pro, igual que la gráfica: el free no los ve ni
    // en la fila de cifras básicas (donde sí ve vistas y me gusta).
    await expect(page.getByTestId('stats-impressions')).not.toBeVisible();
    await expect(page.getByTestId('stats-ctr')).not.toBeVisible();
    await expect(page.getByTestId('stats-upgrade-cta')).toContainText('veces listado');
  });

  test('usuario PRO ve la gráfica, el ratio, el agregado y las «veces listado» — sin CTA de upgrade', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await page.goto('/mis-anuncios/estadisticas');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('stats-listing-select')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('stats-basic')).toBeVisible();
    // `stats-chart` lo pinta ahora el StatsChart EXTRAÍDO (components/stats/) — que es lo
    // que hace estructural la barrera de la extracción: el componente reusable es el que
    // se ve en la aplicación real, no una copia que el vendedor conserve por su cuenta.
    await expect(page.getByTestId('stats-chart')).toBeVisible();
    await expect(page.getByTestId('stats-summary')).toBeVisible();

    // A2 — la cifra en la fila básica y la tarjeta que EXPLICA qué es cada número.
    await expect(page.getByTestId('stats-impressions')).toContainText('veces listado');
    await expect(page.getByTestId('stats-ctr')).toBeVisible();
    await expect(page.getByTestId('stats-ctr')).toContainText('página de resultados');

    await expect(page.getByTestId('stats-upgrade-cta')).not.toBeVisible();
  });
});
