// H6.2 — Playwright E2E: páginas de categoría migradas a Meilisearch.
//
// Verifica:
//   1. /coches (categoría hoja) muestra el FilterPanel y el anuncio aparece via Meili.
//   2. /vehiculos (categoría padre) agrega anuncios de sus hijas (coches).
//   3. Filtrar por tipo en la categoría funciona correctamente.
//
// Notas:
//   - Timeout de 25 s para encontrar tarjetas: la indexación en Meilisearch es asíncrona
//     (BullMQ worker). La tarjeta puede tardar unos segundos en estar disponible.
//   - Usa sellerContext (usuario free) con el límite de 5 anuncios activos; si los tests
//     acumulan anuncios activos, publicar puede fallar (riesgo conocido del test DB compartido).

import path from 'path';
import { test, expect } from './fixtures/auth';
import { waitForCard } from './helpers/wait-for-card';


async function publishCocheMinimal(
  page: import('@playwright/test').Page,
  title: string,
): Promise<void> {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();

  await page.getByRole('button', { name: 'Vehículos', exact: true }).click();
  await page.getByRole('button', { name: 'Coches', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="foto-input"]').setInputFiles(
    path.join(__dirname, 'fixtures', 'test-image.png'),
  );
  await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
  await page.locator('#title').fill(title);
  await page.locator('#description').fill('Coche de prueba para test H6.2.');
  // Use PRODUCT type so we can test type filtering (test 3 relies on this).
  await page.getByLabel('Producto').click();
  // Condition is required for PRODUCT type — without it the validator blocks Next.
  // #condition is the shadcn SelectTrigger; clicking opens the listbox portal.
  await page.locator('#condition').click();
  await page.getByRole('option', { name: 'Buen estado' }).click();
  await page.locator('#price').fill('8000');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  await page.locator('#attr-year').fill('2019');
  await page.locator('#attr-km').fill('40000');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
  await page.locator('#city').fill('Madrid');
  await page.locator('#province').fill('Madrid');
  await page.getByRole('button', { name: 'Revisar' }).click();

  await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar ahora' }).click();
  await page.waitForURL('**/anuncio/**', { timeout: 20_000 });
}

test.describe('H6.2 — Categoría vía Meilisearch', () => {

  // A1 — la URL de una categoría hija es ahora anidada (/vehiculos/coches). Cambia
  // la forma de la URL, no lo que este test verifica. La redirección desde la URL
  // vieja tiene su propia batería: categoria-urls-anidadas.spec.ts.
  test('Categoría hoja /vehiculos/coches: FilterPanel visible + anuncio aparece via Meili', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    const TITLE = `H6.2 Coche hoja ${Date.now()}`;

    await publishCocheMinimal(page, TITLE);

    await waitForCard(page, '/vehiculos/coches', TITLE);

    // FilterPanel must be visible (only present after H6.2 migration)
    await expect(page.getByRole('complementary', { name: 'Filtros' })).toBeVisible({ timeout: 5_000 });
  });

  test('Categoría padre /vehiculos: incluye anuncios de la hija /coches', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    const TITLE = `H6.2 Coche padre ${Date.now()}`;

    await publishCocheMinimal(page, TITLE);

    await waitForCard(page, '/vehiculos', TITLE);

    await expect(page.getByRole('heading', { name: 'Vehículos' })).toBeVisible();
  });

  test('Filtro de tipo: type=PRODUCT muestra el coche; type=SERVICE no lo muestra', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    const TITLE = `H6.2 Filtro tipo ${Date.now()}`;

    // Published as PRODUCT (see publishCocheMinimal above)
    await publishCocheMinimal(page, TITLE);

    // Filter by PRODUCT — listing must appear
    await waitForCard(page, `/coches?type=PRODUCT`, TITLE);

    // Filter by SERVICE — same listing must NOT appear
    await page.goto(`/coches?type=SERVICE`);
    await page.waitForLoadState('networkidle');

    // Give Meilisearch time to respond, then assert absence
    await page.waitForTimeout(3_000);
    const cardService = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE });
    await expect(cardService).not.toBeVisible();
  });

  test('Página de categoría vacía o sin resultados: no rompe el SSR', async ({ page }) => {
    // Navigate to a valid category that might have no listings with this filter
    await page.goto('/vehiculos/coches?type=SERVICE&condition=FOR_PARTS');
    await page.waitForLoadState('networkidle');

    // Page must render without crashing (h1 visible, no error boundary)
    await expect(page.getByRole('heading', { name: 'Coches' })).toBeVisible();
    // Either results or empty state — not a crash
    const hasResults = await page.locator('a[href*="/anuncio/"]').first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByRole('heading', { name: /Sin resultados|No hay anuncios/ }).isVisible().catch(() => false);
    expect(hasResults || hasEmptyState).toBe(true);
  });

});
