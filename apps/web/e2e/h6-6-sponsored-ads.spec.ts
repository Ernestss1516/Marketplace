// H6.6 Bloque C — Playwright E2E: anuncios patrocinados.
//
// Backend (CRUD admin, inyección por categoría/hijas, caché Redis, AuditLog)
// ya cubierto en h6-6-sponsored-ads.e2e-spec.ts (Jest). Aquí solo lo
// verificable end-to-end: el admin crea un patrocinado con imagen → aparece
// en la búsqueda de esa categoría (o de su hija) en página 1 como
// "Publicidad" → el enlace navega externo en pestaña nueva → desactivarlo lo
// quita de inmediato.

import * as path from 'path';
import { test, expect } from './fixtures/auth';

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createSponsoredAd(
  page: import('@playwright/test').Page,
  opts: { title: string; description: string; targetUrl: string; categoryOption: string },
) {
  await page.goto('/admin/sponsored-ads');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Nuevo patrocinado' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('[data-testid="sponsored-ad-image-input"]').setInputFiles(TEST_IMAGE);
  await expect(page.getByRole('button', { name: 'Cambiar imagen' })).toBeVisible({ timeout: 15_000 });

  await page.locator('#sponsored-title').fill(opts.title);
  await page.locator('#sponsored-description').fill(opts.description);
  await page.locator('#sponsored-target-url').fill(opts.targetUrl);

  await page.locator('#sponsored-category').click();
  await page.getByRole('option', { name: opts.categoryOption, exact: true }).click();

  await page.getByRole('button', { name: 'Crear patrocinado' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
}

test.describe('Admin — gestión de patrocinados', () => {
  test('crea un patrocinado y lo ve en el listado', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const title = uniqueTitle('E2E Patrocinado');

    await createSponsoredAd(page, {
      title,
      description: 'Descripción del patrocinado E2E',
      targetUrl: 'https://example.com/promo-e2e',
      categoryOption: 'Coches',
    });

    const row = page.locator('tr').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Vigente');
  });
});

test.describe('Patrocinados en la búsqueda', () => {
  test('aparece en /coches (pág 1) como "Publicidad" y el enlace navega externo en pestaña nueva', async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Sponsored Coches');
    const targetUrl = 'https://example.com/promo-coches';

    await createSponsoredAd(adminPage, {
      title,
      description: 'Aparece en la categoría Coches',
      targetUrl,
      categoryOption: 'Coches',
    });

    const page = await buyerContext.newPage();
    await page.goto('/vehiculos/coches');
    await page.waitForLoadState('networkidle');

    const card = page.getByTestId('sponsored-card').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('Publicidad')).toBeVisible();

    // Verificación a nivel de atributo, no de navegación real: el entorno de
    // test no tiene salida a redes externas (example.com resuelve a un error
    // de red), así que en vez de comprobar que la navegación externa
    // TERMINA con éxito, comprobamos el mecanismo que la garantiza — href,
    // target=_blank y rel=noopener noreferrer (protección tabnabbing) — y que
    // el click efectivamente abre una pestaña nueva (no navega la actual).
    await expect(card).toHaveAttribute('href', targetUrl);
    await expect(card).toHaveAttribute('target', '_blank');
    await expect(card).toHaveAttribute('rel', 'noopener noreferrer');

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      card.click(),
    ]);
    expect(page.url()).not.toBe(targetUrl); // la pestaña original no navegó
    await newPage.close();
  });

  test('patrocinado de la categoría padre (Vehículos) aparece también al buscar la hija (Coches)', async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Sponsored Vehiculos');

    await createSponsoredAd(adminPage, {
      title,
      description: 'Vinculado a Vehículos, debe verse en Coches',
      targetUrl: 'https://example.com/promo-vehiculos',
      categoryOption: 'Vehículos (todas)',
    });

    const page = await buyerContext.newPage();
    await page.goto('/vehiculos/coches');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sponsored-card').filter({ hasText: title })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('desactivar el patrocinado lo quita de la búsqueda de inmediato', async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Sponsored Deactivate');

    await createSponsoredAd(adminPage, {
      title,
      description: 'Se desactiva y desaparece',
      targetUrl: 'https://example.com/promo-deactivate',
      categoryOption: 'Coches',
    });

    const page = await buyerContext.newPage();
    await page.goto('/vehiculos/coches');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sponsored-card').filter({ hasText: title })).toBeVisible({
      timeout: 10_000,
    });

    const row = adminPage.locator('tr').filter({ hasText: title });
    await row.getByRole('button', { name: 'Desactivar' }).click();
    await expect(row.getByText('Inactivo')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sponsored-card').filter({ hasText: title })).not.toBeVisible();
  });
});
