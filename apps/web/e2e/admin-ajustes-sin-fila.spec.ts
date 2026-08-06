// UI SETTINGS — las tres claves que nacen SIN fila en la base son editables desde
// /admin/ajustes.
//
// El bug tenía dos capas y hacen falta las dos para verlo: el PATCH devolvía 404 si
// la fila no existía (arreglado antes, con upsert), y el editor hacía
// `if (!setting) return null` sobre una lista ORDER que ni siquiera las incluía. Con
// el backend arreglado seguían siendo invisibles.
//
// Lo que se ejerce aquí es el ciclo completo que antes era imposible:
// SIN FILA → se pinta con su DEFAULT → primer guardado la CREA → recargar muestra el
// valor guardado (ya no el default).
//
// El estado "sin fila" está garantizado: `global-setup.ts` trunca la base
// (`reset-test-db.js`) antes de cada corrida y ninguno de los dos seeds siembra estas
// tres claves. Al final el spec las devuelve a su valor por defecto — no se pueden
// borrar por API, así que se restauran al valor que tendrían sin fila, para no
// cambiar el comportamiento de las specs que corran después.

import { test, expect } from './fixtures/auth';
import type { Page, Locator } from '@playwright/test';
import { adminApiToken } from './helpers/api';

const API_BASE = 'http://localhost:3001';

const TARJETA_MAX_TAGS = 'Máximo de tags por anuncio';
const TARJETA_SOPORTE = 'Buzón de soporte';
const TARJETA_VENTANA = 'Ventana de reapertura y cierre de tickets';

function cardFor(page: Page, title: string): Locator {
  return page
    .locator('div.rounded-md.border.bg-background.p-5')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

test.describe('Ajustes sin fila — visibles, con su default, y editables', () => {
  test('el ciclo completo: sin fila → default → guardar la crea → persiste', async ({
    adminContext,
    request,
  }) => {
    // Los defaults se LEEN DEL BACKEND, no se escriben aquí: si alguien cambia
    // DEFAULT_MAX_TAGS_PER_LISTING, este test lo sigue en vez de romperse por un 5
    // hardcodeado — que es exactamente la divergencia que el diseño quería evitar.
    const token = adminApiToken();
    const antes = await (await request.get(`${API_BASE}/api/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const porClave = Object.fromEntries(
      (antes as { key: string; value: unknown; configured?: boolean }[]).map((s) => [s.key, s]),
    );

    // Precondición del test: las tres llegan SIN fila. Si esto falla, el spec no
    // está probando lo que dice (alguien las sembró o una corrida previa las creó).
    expect(porClave['maxTagsPerListing'].configured).toBe(false);
    expect(porClave['supportEmail'].configured).toBe(false);
    expect(porClave['ticketAutoCloseWindowDays'].configured).toBe(false);

    const defaultMaxTags = String(porClave['maxTagsPerListing'].value);
    const defaultVentana = String(porClave['ticketAutoCloseWindowDays'].value);

    const page = await adminContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForLoadState('networkidle');

    // ── 1. Las tres se PINTAN, que es lo que el `return null` impedía ───────────
    const cardTags = cardFor(page, TARJETA_MAX_TAGS);
    const cardSoporte = cardFor(page, TARJETA_SOPORTE);
    const cardVentana = cardFor(page, TARJETA_VENTANA);

    await expect(cardTags).toBeVisible();
    await expect(cardSoporte).toBeVisible();
    await expect(cardVentana).toBeVisible();

    // ── 2. Con su DEFAULT como valor inicial, no vacías ni con error ────────────
    await expect(cardTags.locator('input[type="number"]')).toHaveValue(defaultMaxTags);
    await expect(cardVentana.locator('input[type="number"]')).toHaveValue(defaultVentana);
    await expect(cardSoporte.locator('input[type="email"]')).toHaveValue('');

    // Y se dice que no están configuradas, en vez de inventar una fecha.
    await expect(cardTags.getByText('Sin configurar', { exact: false })).toBeVisible();

    // ── 3. Primer guardado: CREA la fila (esto daba 404 antes del fix) ──────────
    await cardTags.locator('input[type="number"]').fill('3');
    await cardTags.getByRole('button', { name: 'Guardar' }).click();
    await expect(cardTags.getByText('Guardado')).toBeVisible();

    await cardSoporte.locator('input[type="email"]').fill('soporte-e2e@example.com');
    await cardSoporte.getByRole('button', { name: 'Guardar' }).click();
    await expect(cardSoporte.getByText('Guardado')).toBeVisible();

    await cardVentana.locator('input[type="number"]').fill('21');
    await cardVentana.getByRole('button', { name: 'Guardar' }).click();
    await expect(cardVentana.getByText('Guardado')).toBeVisible();

    // ── 4. Recargar: el valor guardado, ya NO el default ────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(cardFor(page, TARJETA_MAX_TAGS).locator('input[type="number"]')).toHaveValue('3');
    await expect(cardFor(page, TARJETA_SOPORTE).locator('input[type="email"]'))
      .toHaveValue('soporte-e2e@example.com');
    await expect(cardFor(page, TARJETA_VENTANA).locator('input[type="number"]')).toHaveValue('21');

    // Y la fila existe de verdad, no es estado de cliente.
    const despues = await (await request.get(`${API_BASE}/api/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const ahora = Object.fromEntries(
      (despues as { key: string; value: unknown; configured?: boolean }[]).map((s) => [s.key, s]),
    );
    expect(ahora['maxTagsPerListing'].configured).toBe(true);
    expect(ahora['maxTagsPerListing'].value).toBe(3);
    expect(ahora['supportEmail'].value).toBe('soporte-e2e@example.com');
    expect(ahora['ticketAutoCloseWindowDays'].value).toBe(21);

    // Ya no dice "Sin configurar": ahora hay fecha.
    await expect(cardFor(page, TARJETA_MAX_TAGS).getByText('Actualizado:', { exact: false }))
      .toBeVisible();

    // ── 5. Restaurar a los defaults (no se puede borrar la fila por API) ────────
    for (const [titulo, valor] of [
      [TARJETA_MAX_TAGS, defaultMaxTags],
      [TARJETA_VENTANA, defaultVentana],
    ] as const) {
      const card = cardFor(page, titulo);
      await card.locator('input[type="number"]').fill(valor);
      await card.getByRole('button', { name: 'Guardar' }).click();
      await expect(card.getByText('Guardado')).toBeVisible();
    }
    const cardSoporteFin = cardFor(page, TARJETA_SOPORTE);
    await cardSoporteFin.locator('input[type="email"]').fill('');
    await cardSoporteFin.getByRole('button', { name: 'Guardar' }).click();
    await expect(cardSoporteFin.getByText('Guardado')).toBeVisible();
  });

  test('la validación de cliente avisa antes de mandar un 0', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForLoadState('networkidle');

    const card = cardFor(page, TARJETA_MAX_TAGS);
    await card.locator('input[type="number"]').fill('0');
    await card.getByRole('button', { name: 'Guardar' }).click();

    await expect(card.getByText(/número entero positivo/i)).toBeVisible();
    // Y NO se ha guardado: sin "Guardado" a la vista.
    await expect(card.getByText('Guardado')).toHaveCount(0);
  });

  test('un ajuste que YA se editaba antes sigue editándose igual', async ({ adminContext }) => {
    // El editor se ha tocado (ORDER, el fallback de `!setting`, la fecha): esto
    // confirma que no se ha llevado por delante lo que ya funcionaba.
    const page = await adminContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForLoadState('networkidle');

    const card = cardFor(page, 'Caducidad de anuncios');
    const input = card.locator('input[type="number"]');
    const original = await input.inputValue();

    await input.fill('45');
    await card.getByRole('button', { name: 'Guardar' }).click();
    await expect(card.getByText('Guardado')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    const tras = cardFor(page, 'Caducidad de anuncios');
    await expect(tras.locator('input[type="number"]')).toHaveValue('45');

    await tras.locator('input[type="number"]').fill(original);
    await tras.getByRole('button', { name: 'Guardar' }).click();
    await expect(tras.getByText('Guardado')).toBeVisible();
  });
});
