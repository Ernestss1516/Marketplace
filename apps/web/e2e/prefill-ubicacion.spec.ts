// RL5.1-A — Playwright E2E: prefill de ubicación del perfil en el wizard de creación.
//
// Verifica:
//   1. Usuario SIN ubicación en perfil → campos city/province vacíos al arrancar el wizard.
//   2. Usuario CON ubicación en perfil → wizard precarga esos campos como sugerencia editable.
//   3. Editar un anuncio existente → muestra la ubicación DEL ANUNCIO, no la del perfil.

import { test, expect } from './fixtures/auth';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate through the publish wizard until the Ubicación step. */
async function goToUbicacionStep(page: import('@playwright/test').Page) {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
  await page.getByRole('button', { name: 'Electrónica', exact: true }).click();
  await page.getByRole('button', { name: 'Móviles', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
  await page.locator('#title').fill(`Prefill test ${Date.now()}`);
  await page.locator('#description').fill('Prueba RL5.1-A prefill ubicación.');
  await page.getByLabel('Servicio').click();
  await page.locator('#price').fill('10');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  // Atributos (Móviles: all optional → skip)
  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
}

/** Click Siguiente until the Ubicación step heading is visible (max 4 clicks). */
async function advanceToUbicacionInEditWizard(page: import('@playwright/test').Page) {
  for (let i = 0; i < 4; i++) {
    const heading = await page.locator('h2').first().textContent({ timeout: 5_000 }).catch(() => '');
    if (heading?.includes('Ubicación')) return;
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.waitForTimeout(400);
  }
  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible({ timeout: 5_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('RL5.1-A — Prefill de ubicación del perfil', () => {

  test('wizard: usuario SIN ubicación en perfil → campos vacíos', async ({ sellerContext }) => {
    // seller-e2e is seeded with city=null, province=null (seed-playwright.ts resets on update).
    const page = await sellerContext.newPage();
    await goToUbicacionStep(page);

    await expect(page.locator('#city')).toHaveValue('');
    await expect(page.locator('#province')).toHaveValue('');
  });

  test('wizard: usuario CON ubicación en perfil → campos prefillados y editables', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    // 1. Set the seller's profile location via /perfil.
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();

    const cityInput = page.locator('[data-testid="perfil-city-autocomplete"] input, #city').first();
    await cityInput.fill('Sabadell');
    const option = page.locator('[role="option"]').filter({ hasText: 'Sabadell' }).first();
    await expect(option).toBeVisible({ timeout: 8_000 });
    await option.click();
    await expect(page.locator('#city')).toHaveValue('Sabadell');
    await expect(page.locator('#province')).toHaveValue('Barcelona');

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Perfil actualizado correctamente')).toBeVisible({ timeout: 8_000 });

    // 2. Open the publish wizard — publicar/page.tsx calls getMe() to get profile location.
    await goToUbicacionStep(page);

    // 3. Verify prefill: fields show the profile's saved location.
    await expect(page.locator('#city')).toHaveValue('Sabadell');
    await expect(page.locator('#province')).toHaveValue('Barcelona');

    // 4. Prefill is editable: user can override without issue.
    await page.locator('#city').fill('Madrid');
    const madridOption = page.locator('[role="option"]').filter({ hasText: 'Madrid' }).first();
    await expect(madridOption).toBeVisible({ timeout: 8_000 });
    await madridOption.click();
    await expect(page.locator('#city')).toHaveValue('Madrid');
    await expect(page.locator('#province')).toHaveValue('Madrid');
  });

  test('editar anuncio: usa la ubicación DEL ANUNCIO, no la del perfil', async ({ sellerContext }) => {
    // After the previous test the seller's DB profile has city=Sabadell.
    // listing-rf11-e2e is seeded with city=Madrid, province=Madrid.
    // EditarWizard must show Madrid (listing data), NOT Sabadell (profile data).
    const page = await sellerContext.newPage();

    // Navigate to the edit page via /mis-anuncios.
    await page.goto('/mis-anuncios');
    await page.waitForLoadState('networkidle');

    // Find the card for listing-rf11-e2e and click its edit link. Scoped to
    // MyListingCard's own data-testid (listing-card-{id}) — NOT a generic
    // "first Editar link on the page" fallback. That fallback used to be here
    // silently matching whichever listing was most recently updated ANYWHERE
    // in the suite (the intended selector, `li, article, [data-testid=
    // "listing-item"], tr`, never matches this app's DOM — MyListingCard
    // renders a plain shadcn <Card>/<div>) — order-dependent and wrong
    // whenever another test published/updated a different listing more
    // recently. See docs/estado-tecnico.md, "Nota de proceso — CI flaky
    // Playwright" for the full diagnosis.
    const listingCard = page
      .locator('[data-testid^="listing-card-"]')
      .filter({ hasText: 'Anuncio RF.11 E2E' });
    const editLink = listingCard.getByRole('link', { name: /editar/i });

    // Retry-the-click: same intermittent Next.js App Router click-navigation
    // race under `next start` mitigated in flujo-critico.spec.ts and
    // busqueda-mapa.spec.ts (see docs/estado-tecnico.md, "Nota de proceso — CI
    // flaky Playwright") — the click registers but the transition occasionally
    // never commits, with no console/page error. Retrying the click itself is
    // the reliable mitigation, not just retrying the wait.
    await expect(async () => {
      await editLink.click();
      await page.waitForURL('**/editar**', { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    // EditarWizard starts at Fotos; advance through steps to Ubicación.
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
    await advanceToUbicacionInEditWizard(page);

    // Verify the edit wizard shows the LISTING's location (Madrid), not the profile's (Sabadell).
    await expect(page.locator('#city')).toHaveValue('Madrid');
    await expect(page.locator('#province')).toHaveValue('Madrid');
  });

});
