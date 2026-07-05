// H8.4 — Playwright E2E: badge "Pro" en el perfil público del vendedor (/vendedor/[slug]).
//
// pro-e2e@example.com (slug: usuario-pro-e2e) tiene una Subscription + Entitlement
// PRO_SUBSCRIPTION activos (seed-playwright.ts). seller-e2e@example.com (slug: vendedor-e2e)
// no es Pro — sirve de control negativo.

import { test, expect } from './fixtures/auth';

test.describe('Badge Pro en /vendedor/[slug]', () => {
  test('el perfil de un vendedor Pro muestra el badge "Pro" junto al nombre', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();

    await page.goto('/vendedor/usuario-pro-e2e');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Usuario Pro E2E' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('seller-pro-badge')).toBeVisible();
    await expect(page.getByTestId('seller-pro-badge')).toContainText('Pro');
  });

  test('el perfil de un vendedor no-Pro no muestra ningún badge — nada roto', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();

    await page.goto('/vendedor/vendedor-e2e');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Vendedor E2E' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('seller-pro-badge')).not.toBeVisible();
  });
});
