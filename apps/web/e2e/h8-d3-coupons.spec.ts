// H8 Bloque D fase 3b — Playwright E2E: admin CRUD de cupones + canje.
//
// Backend (validación cruzada, concurrencia, 403 no-admin) ya cubierto en
// h8-d3a-coupons.e2e-spec.ts / h8-d3b-coupons-admin.e2e-spec.ts (Jest). Aquí
// solo lo verificable end-to-end: el admin gestiona cupones desde la UI y un
// usuario los canjea con mensajes legibles.

import * as path from 'path';
import { test, expect } from './fixtures/auth';

function uniqueCode(prefix: string) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe('Admin — gestión de cupones', () => {
  test('crea un cupón de créditos y lo ve en el listado con sus usos', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const code = uniqueCode('E2ECRED');

    await page.goto('/admin/cupones');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Nuevo cupón' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.locator('#coupon-code').fill(code);
    // rewardType ya es CREDITS por defecto
    await page.locator('#coupon-credit-amount').fill('40');
    await page.locator('#coupon-max-redemptions').fill('10');

    const now = new Date();
    const soon = new Date(now.getTime() + 60_000);
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#coupon-starts-at').fill(toLocal(soon.getTime() < now.getTime() ? now : new Date(now.getTime() - 60_000)));
    await page.locator('#coupon-ends-at').fill(toLocal(later));

    await page.getByRole('button', { name: 'Crear cupón' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Aparece en el listado, código en mayúsculas, usos 0/10
    const row = page.locator('tr').filter({ hasText: code.toUpperCase() });
    await expect(row).toBeVisible();
    await expect(row).toContainText('40 créditos');
    await expect(row).toContainText('0/10');
  });

  test('activar/desactivar un cupón desde el listado', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const code = uniqueCode('E2ETOGGLE');

    await page.goto('/admin/cupones');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nuevo cupón' }).click();
    await page.locator('#coupon-code').fill(code);
    await page.locator('#coupon-credit-amount').fill('10');
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#coupon-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await page.locator('#coupon-ends-at').fill(toLocal(later));
    await page.getByRole('button', { name: 'Crear cupón' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    const row = page.locator('tr').filter({ hasText: code.toUpperCase() });
    await expect(row).toBeVisible();

    // Desactivar
    await row.getByRole('button', { name: 'Desactivar' }).click();
    await expect(row.getByText('Inactivo')).toBeVisible({ timeout: 10_000 });

    // Reactivar
    await row.getByRole('button', { name: 'Activar' }).click();
    await expect(row.getByText('Inactivo')).not.toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Canje de cupones', () => {
  test('CREDITS válido → mensaje de éxito legible', async ({ adminContext, buyerContext }) => {
    // Admin crea el cupón
    const adminPage = await adminContext.newPage();
    const code = uniqueCode('E2EREDEEM');

    await adminPage.goto('/admin/cupones');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByRole('button', { name: 'Nuevo cupón' }).click();
    await adminPage.locator('#coupon-code').fill(code);
    await adminPage.locator('#coupon-credit-amount').fill('25');
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await adminPage.locator('#coupon-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await adminPage.locator('#coupon-ends-at').fill(toLocal(later));
    await adminPage.getByRole('button', { name: 'Crear cupón' }).click();
    await expect(adminPage.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Buyer lo canjea
    const buyerPage = await buyerContext.newPage();
    await buyerPage.goto('/mis-creditos');
    await buyerPage.waitForLoadState('networkidle');

    await buyerPage.getByTestId('coupon-code-input').fill(code);
    await buyerPage.getByTestId('coupon-redeem-button').click();

    await expect(buyerPage.getByTestId('coupon-success')).toContainText('+25 créditos añadidos');
  });

  test('código inválido → mensaje legible, sin romper el formulario', async ({ buyerContext }) => {
    const page = await buyerContext.newPage();
    await page.goto('/mis-creditos');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('coupon-code-input').fill('NO-EXISTE-XYZ');
    await page.getByTestId('coupon-redeem-button').click();

    await expect(page.getByTestId('coupon-error')).toContainText('Código no válido');
    // El formulario sigue funcional (no se quedó en un estado roto)
    await expect(page.getByTestId('coupon-code-input')).toBeEnabled();
  });

  test('ya canjeado por este usuario → mensaje legible', async ({ adminContext, buyerContext }) => {
    const adminPage = await adminContext.newPage();
    const code = uniqueCode('E2EDUP');

    await adminPage.goto('/admin/cupones');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByRole('button', { name: 'Nuevo cupón' }).click();
    await adminPage.locator('#coupon-code').fill(code);
    await adminPage.locator('#coupon-credit-amount').fill('5');
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await adminPage.locator('#coupon-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await adminPage.locator('#coupon-ends-at').fill(toLocal(later));
    await adminPage.getByRole('button', { name: 'Crear cupón' }).click();
    await expect(adminPage.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    const buyerPage = await buyerContext.newPage();
    await buyerPage.goto('/mis-creditos');
    await buyerPage.waitForLoadState('networkidle');

    await buyerPage.getByTestId('coupon-code-input').fill(code);
    await buyerPage.getByTestId('coupon-redeem-button').click();
    await expect(buyerPage.getByTestId('coupon-success')).toBeVisible({ timeout: 10_000 });

    // Segundo canje del MISMO usuario
    await buyerPage.reload();
    await buyerPage.waitForLoadState('networkidle');
    await buyerPage.getByTestId('coupon-code-input').fill(code);
    await buyerPage.getByTestId('coupon-redeem-button').click();
    await expect(buyerPage.getByTestId('coupon-error')).toContainText('Ya has usado este cupón');
  });

  test('FEATURED requiere elegir anuncio → se destaca el elegido', async ({
    adminContext,
    sellerContext,
  }) => {
    // Seller publica un anuncio propio para tener algo que destacar (mismo
    // recorrido de wizard que flujo-critico.spec.ts).
    const sellerPage = await sellerContext.newPage();
    const LISTING_TITLE = `Cupón E2E ${Date.now()}`;
    await sellerPage.goto('/publicar');
    await expect(sellerPage.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await sellerPage.getByRole('button', { name: 'Electrónica' }).click();
    await sellerPage.getByRole('button', { name: 'Móviles' }).click();
    await expect(sellerPage.getByRole('heading', { name: 'Fotos' })).toBeVisible();
    await sellerPage
      .locator('[data-testid="foto-input"]')
      .setInputFiles(path.join(__dirname, 'fixtures', 'test-image.png'));
    await expect(sellerPage.getByText('Portada', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await sellerPage.getByRole('button', { name: 'Siguiente' }).click();
    await expect(sellerPage.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await sellerPage.locator('#title').fill(LISTING_TITLE);
    await sellerPage.locator('#description').fill('Anuncio de prueba para canje de cupón FEATURED.');
    await sellerPage.getByLabel('Producto').click();
    await sellerPage.locator('#condition').click();
    await sellerPage.getByRole('option', { name: 'Buen estado' }).click();
    await sellerPage.locator('#price').fill('10');
    await sellerPage.getByRole('button', { name: 'Siguiente' }).click();
    await expect(sellerPage.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await sellerPage.getByRole('button', { name: 'Siguiente' }).click();
    await expect(sellerPage.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await sellerPage.locator('#city').fill('Madrid');
    await sellerPage.locator('[role="option"]').filter({ hasText: 'Madrid' }).first().click();
    await sellerPage.getByRole('button', { name: 'Revisar' }).click();
    await expect(sellerPage.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await sellerPage.getByRole('button', { name: 'Publicar ahora' }).click();
    await sellerPage.waitForURL('**/anuncio/**', { timeout: 20_000 });

    // Admin crea el cupón FEATURED
    const adminPage = await adminContext.newPage();
    const code = uniqueCode('E2EFEAT');
    await adminPage.goto('/admin/cupones');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByRole('button', { name: 'Nuevo cupón' }).click();
    await adminPage.locator('#coupon-code').fill(code);
    await adminPage.getByRole('combobox').click();
    await adminPage.getByRole('option', { name: 'Destacado' }).click();
    await adminPage.locator('#coupon-featured-days').fill('7');
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await adminPage.locator('#coupon-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await adminPage.locator('#coupon-ends-at').fill(toLocal(later));
    await adminPage.getByRole('button', { name: 'Crear cupón' }).click();
    await expect(adminPage.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Seller canjea — sin listingId primero, ve el selector, elige su anuncio
    await sellerPage.goto('/mis-creditos');
    await sellerPage.waitForLoadState('networkidle');
    await sellerPage.getByTestId('coupon-code-input').fill(code);
    await sellerPage.getByTestId('coupon-redeem-button').click();

    await expect(sellerPage.getByTestId('coupon-listing-select')).toBeVisible({ timeout: 10_000 });
    await sellerPage.getByTestId('coupon-listing-select').click();
    await sellerPage.getByRole('option', { name: LISTING_TITLE }).click();
    await sellerPage.getByTestId('coupon-confirm-listing-button').click();

    await expect(sellerPage.getByTestId('coupon-success')).toContainText('Anuncio destacado 7 días');
  });
});
