// H8.1 — Playwright E2E: los ajustes numéricos de límites/cuota son editables
// desde /admin/ajustes (freeActiveListingLimit, proActiveListingLimit ya estaban
// en la whitelist del backend desde RF.7 pero no se exponían en esta UI;
// proMonthlyFeaturedQuota es nuevo en H8.1).
//
// Test: ADMIN cambia el valor de los tres ajustes numéricos y se persiste tras
// recargar la página. Restaura los valores originales al final para no dejar
// efectos secundarios en otras specs que compartan la misma base de datos.

import { test, expect } from './fixtures/auth';
import type { Page, Locator } from '@playwright/test';

const SETTINGS = [
  { title: 'Límite de anuncios activos (Free)', newValue: '7' },
  { title: 'Límite de anuncios activos (Pro)', newValue: '25' },
  { title: 'Cuota mensual de destacados (Pro)', newValue: '5' },
] as const;

function cardFor(page: Page, title: string): Locator {
  return page
    .locator('div.rounded-md.border.bg-background.p-5')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

test('ADMIN edita los ajustes numéricos de límites y cuota Pro en /admin/ajustes', async ({
  adminContext,
}) => {
  const page = await adminContext.newPage();
  await page.goto('/admin/ajustes');
  await page.waitForLoadState('networkidle');

  const originalValues: Record<string, string> = {};

  for (const { title, newValue } of SETTINGS) {
    const card = cardFor(page, title);
    await expect(card).toBeVisible();

    const input = card.locator('input[type="number"]');
    originalValues[title] = await input.inputValue();

    await input.fill(newValue);
    await card.getByRole('button', { name: 'Guardar' }).click();
    await expect(card.getByText('Guardado')).toBeVisible();
  }

  // Persistencia: recargar y confirmar que el backend devuelve los nuevos valores.
  await page.reload();
  await page.waitForLoadState('networkidle');

  for (const { title, newValue } of SETTINGS) {
    const input = cardFor(page, title).locator('input[type="number"]');
    await expect(input).toHaveValue(newValue);
  }

  // Restaurar valores originales.
  for (const { title } of SETTINGS) {
    const card = cardFor(page, title);
    await card.locator('input[type="number"]').fill(originalValues[title]);
    await card.getByRole('button', { name: 'Guardar' }).click();
    await expect(card.getByText('Guardado')).toBeVisible();
  }
});
