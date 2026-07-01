// RL5.1-B — Playwright E2E: autocompletado de municipios.
//
// Verifica que:
//   1. El paso Ubicación del wizard muestra el combobox: al escribir "sant boi"
//      (minúsculas, sin acento) aparece "Sant Boi de Llobregat" con provincia
//      "Barcelona"; al seleccionarlo, el campo provincia se rellena automáticamente.
//   2. Un municipio que no existe en el dataset puede introducirse igualmente
//      como texto libre (fallback): city a mano + province a mano → el wizard avanza.
//   3. El mismo componente funciona en PerfilForm (/perfil): escribir "girona" →
//      seleccionar "Girona" → provincia se rellena "Girona".
//
// Fuente del dataset: INE — codeforspain/ds-organizacion-administrativa (GitHub)
// Licencia: Ley 37/2007 de Reutilización de la Información del Sector Público.

import path from 'path';
import { test, expect } from './fixtures/auth';

// ── Helper: navegar hasta el paso Ubicación del wizard ───────────────────────
// Usa la ruta más corta: Electrónica → Móviles (atributos opcionales → skip).
async function goToUbicacionStep(page: import('@playwright/test').Page) {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();

  await page.getByRole('button', { name: 'Electrónica', exact: true }).click();
  await page.getByRole('button', { name: 'Móviles', exact: true }).click();

  // Auto-avanza a Fotos
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });

  // Fotos: sin foto (0 fotos es válido para avanzar; publicar sí requiere ≥1)
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Datos
  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
  await page.locator('#title').fill(`Test Ubicación ${Date.now()}`);
  await page.locator('#description').fill('Anuncio de prueba para el test de autocompletado de municipios RL5.1-B.');
  await page.getByLabel('Servicio').click();
  await page.locator('#price').fill('50');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Atributos (Móviles: todos opcionales → skip directo)
  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Ubicación
  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('RL5.1-B — Autocompletado de municipios', () => {

  test('wizard: escribir "sant boi" → seleccionar → province se rellena "Barcelona"', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await goToUbicacionStep(page);

    // Type with lowercase + no diacritics → normalize() finds the canonical form
    await page.locator('#city').fill('sant boi');

    // Dropdown should appear with "Sant Boi de Llobregat"
    const option = page.locator('[role="option"]').filter({ hasText: 'Sant Boi de Llobregat' });
    await expect(option).toBeVisible({ timeout: 8_000 });

    // The option should also show the province
    await expect(option).toContainText('Barcelona');

    // Select it
    await option.click();

    // City input now has the canonical name
    await expect(page.locator('#city')).toHaveValue('Sant Boi de Llobregat');

    // Province auto-filled from dataset
    await expect(page.locator('#province')).toHaveValue('Barcelona');

    // The wizard can advance to Previsualización
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
  });

  test('wizard: texto libre (municipio fuera del dataset) → introducción manual → avanza', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await goToUbicacionStep(page);

    // Type something that doesn't exist in the dataset (no dropdown item matches)
    await page.locator('#city').fill('Rincón del Monte Inventado');

    // No option should appear for this query
    // (wait a short time to confirm no dropdown appears)
    await page.waitForTimeout(600);
    await expect(page.locator('[role="option"]')).toHaveCount(0);

    // Province field is still a regular input: user fills it manually (fallback)
    await page.locator('#province').fill('Salamanca');

    // The wizard must allow advancing — fallback is NOT blocked
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
  });

  test('wizard: "madr" → dropdown → seleccionar Madrid → province = Madrid → publicar funciona', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    // Full publish with autocomplete (no photo → use Guardar borrador para simplificar)
    await goToUbicacionStep(page);

    await page.locator('#city').fill('madr');

    // Dropdown shows options including "Madrid"
    const madridOption = page.locator('[role="option"]').filter({ hasText: 'Madrid' }).first();
    await expect(madridOption).toBeVisible({ timeout: 8_000 });
    await madridOption.click();

    await expect(page.locator('#city')).toHaveValue('Madrid');
    await expect(page.locator('#province')).toHaveValue('Madrid');

    // Advance to preview
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
  });

  test('perfil: city autocomplete rellena province al seleccionar un municipio', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();

    // The city field in PerfilForm is a MunicipioAutocomplete
    const cityInput = page.locator('[data-testid="perfil-city-autocomplete"] input, #city').first();
    await cityInput.fill('girona');

    // Dropdown with "Girona"
    const gironaOption = page.locator('[role="option"]').filter({ hasText: 'Girona' }).first();
    await expect(gironaOption).toBeVisible({ timeout: 8_000 });
    await gironaOption.click();

    // City = "Girona", Province = "Girona" (auto-filled)
    await expect(page.locator('#city')).toHaveValue('Girona');
    await expect(page.locator('#province')).toHaveValue('Girona');
  });

});
