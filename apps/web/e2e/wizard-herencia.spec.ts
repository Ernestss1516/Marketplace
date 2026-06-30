// RC5.4 — Playwright E2E: herencia de atributos en el wizard de publicar y editar.
//
// Verifica que:
//   1. Al seleccionar una categoría hija (Coches ← Vehículos), el wizard muestra en el
//      paso "Atributos" tanto los campos heredados del padre (year, km) como los propios
//      de la hija (brand).
//   2. Los campos required del padre se enforzan en el wizard (validación client-side):
//      intentar avanzar sin year → error inline.
//   3. Flujo completo: crear coche con year/km/brand → publicar → la ficha muestra
//      los atributos heredados y propios en la sección "Características".
//   4. EditarWizard precarga los atributos heredados (year, km) con los valores guardados.
//
// Prerequisito en seed-test.ts: vehiculos (year, km required) → coches (brand optional).

import path from 'path';
import { test, expect } from './fixtures/auth';

// ── Helper: navigate through wizard to the "Atributos" step ───────────────────
//
// Selects a two-level category (parent → leaf), skips Fotos (0 photos is valid),
// fills the minimum required Datos fields (SERVICE type so no condition needed),
// and lands on the Atributos step.

async function goToAtributosStep(
  page: import('@playwright/test').Page,
  parentName: string,
  leafName: string,
  title: string,
) {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();

  // exact:true prevents partial matches against sibling categories that share a prefix
  // (e.g. "Vehículos RC5B" created by the rc5b backend spec's beforeAll).
  await page.getByRole('button', { name: parentName, exact: true }).click();
  await page.getByRole('button', { name: leafName, exact: true }).click();

  // Wizard auto-advances to Fotos after getCategoryBySlug resolves
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });

  // Upload one photo: StepPrevisualizacion requires validImages.length >= 1 to
  // enable "Publicar ahora". The "Portada" badge appears once the upload succeeds.
  await page.locator('[data-testid="foto-input"]').setInputFiles(
    path.join(__dirname, 'fixtures', 'test-image.png'),
  );
  await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Datos step — fill minimum required fields
  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
  await page.locator('#title').fill(title);
  await page.locator('#description').fill(
    'Vehículo de prueba para el test de herencia de atributos RC5.4.',
  );
  // Use SERVICE type: no condition selector needed
  await page.getByLabel('Servicio').click();
  await page.locator('#price').fill('15000');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Should land on Atributos step
  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('RC5.4 — Wizard: herencia de atributos', () => {

  test('Atributos: categoría con herencia muestra campos heredados y propios', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await goToAtributosStep(page, 'Vehículos', 'Coches', `Coche E2E fields ${Date.now()}`);

    // Inherited from Vehículos (required → label ends with ' *')
    await expect(page.getByLabel('Año *')).toBeVisible();
    await expect(page.getByLabel('Kilómetros *')).toBeVisible();

    // Own of Coches (optional → no ' *')
    await expect(page.getByLabel('Marca')).toBeVisible();

    // Sanity: should be exactly the 3 expected attribute inputs visible
    // (not some extra phantom field from another category)
    await expect(page.locator('#attr-year')).toBeVisible();
    await expect(page.locator('#attr-km')).toBeVisible();
    await expect(page.locator('#attr-brand')).toBeVisible();
  });

  test('Atributos: campo required heredado bloqueado cuando está vacío', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await goToAtributosStep(page, 'Vehículos', 'Coches', `Coche E2E req ${Date.now()}`);

    // Leave year (Año) empty; fill only the optional brand
    await page.locator('#attr-brand').fill('Toyota');
    // km also empty

    // Try to advance — wizard client-side validation should block
    await page.getByRole('button', { name: 'Siguiente' }).click();

    // Error messages for the two required inherited fields
    await expect(page.getByText('Año es obligatorio.')).toBeVisible();
    await expect(page.getByText('Kilómetros es obligatorio.')).toBeVisible();

    // Still on Atributos step (not advanced)
    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  });

  test('Crear coche con atributos heredados: se guardan y aparecen en la ficha', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    const TITLE = `Coche RC5.4 E2E ${Date.now()}`;

    await goToAtributosStep(page, 'Vehículos', 'Coches', TITLE);

    // Fill ALL attributes (inherited + own)
    await page.locator('#attr-year').fill('2022');
    await page.locator('#attr-km').fill('30000');
    await page.locator('#attr-brand').fill('Toyota');

    // Advance to Ubicación
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();

    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');

    // Advance to Previsualización
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await expect(page.getByText(TITLE)).toBeVisible();

    // Publish
    await page.getByRole('button', { name: 'Publicar ahora' }).click();

    // After publishing, wizard redirects to the listing page
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });
    await expect(page.locator('h1')).toContainText(TITLE);

    // ── Verify attributes appear in the "Características" section ──────────────

    await expect(page.getByRole('heading', { name: 'Características' })).toBeVisible();

    // Labels (from AttributeSchema.label)
    await expect(page.locator('dt').filter({ hasText: 'Año' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Kilómetros' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Marca' })).toBeVisible();

    // Values
    await expect(page.locator('dd').filter({ hasText: '2022' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: '30000 km' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Toyota' })).toBeVisible();
  });

  test('EditarWizard: atributos heredados precargados con valores del listing', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    const TITLE = `Coche Edit E2E ${Date.now()}`;

    // ── Part 1: create the listing via the wizard ──────────────────────────────
    await goToAtributosStep(page, 'Vehículos', 'Coches', TITLE);

    await page.locator('#attr-year').fill('2019');
    await page.locator('#attr-km').fill('75000');
    await page.locator('#attr-brand').fill('Ford');

    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Barcelona');
    await page.locator('#province').fill('Barcelona');

    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    // ── Part 2: navigate to edit via mis-anuncios ──────────────────────────────
    await page.goto('/mis-anuncios');
    await page.waitForLoadState('networkidle');

    // Find the listing row by title and click its edit link
    const listingRow = page.locator('li, article, [data-testid="listing-item"], tr')
      .filter({ hasText: TITLE })
      .first();

    // Fallback: look for any edit link on the page scoped to the title area
    const editLink = listingRow.getByRole('link', { name: /editar/i })
      .or(page.getByRole('link', { name: /editar/i }).first());

    await editLink.click();
    await page.waitForURL('**/editar**', { timeout: 8_000 });

    // ── Part 3: navigate to Atributos step in EditarWizard ────────────────────
    // EditarWizard starts at Fotos step
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();

    // ── Verify pre-filled values (inherited fields carry the saved values) ─────
    await expect(page.locator('#attr-year')).toHaveValue('2019');
    await expect(page.locator('#attr-km')).toHaveValue('75000');
    await expect(page.locator('#attr-brand')).toHaveValue('Ford');
  });

  test('Regresión: categoría SIN herencia (Móviles) sigue funcionando', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await goToAtributosStep(page, 'Electrónica', 'Móviles', `Móvil E2E regr ${Date.now()}`);

    // Móviles owns brand and ram — no inherited fields
    await expect(page.getByLabel('Marca')).toBeVisible();
    await expect(page.getByLabel('RAM')).toBeVisible();

    // year/km must NOT appear (they belong to Vehículos hierarchy)
    await expect(page.locator('#attr-year')).not.toBeVisible();
    await expect(page.locator('#attr-km')).not.toBeVisible();

    // Optional fields: can advance without filling them
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
  });
});
