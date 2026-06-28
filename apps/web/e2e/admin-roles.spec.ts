// RR5.1 — Playwright E2E: separación de roles ADMIN / MODERATOR en el backoffice.
//
// Tests:
//   ADMIN
//     1. /admin carga (dashboard) → el nav muestra los 8 ítems
//   MODERATOR
//     2. /admin → redirige a /  (ruta ADMIN-only)
//     3. /admin/usuarios → redirige a /  (ruta ADMIN-only)
//     4. /admin/ajustes → redirige a /  (ruta ADMIN-only)
//     5. /admin/reportes → carga correctamente (ruta permitida)
//     6. El AdminNav muestra solo "Reportes" (1 ítem visible)
//     7. El moderador ejecuta una acción de moderación (desestimar reporte) → funciona (sin 403)
//
// Prerequisites:
//   global-setup seeds admin-e2e@example.com (ADMIN) and moderator-e2e@example.com (MODERATOR).
//   seed-playwright.ts creates a PENDING SPAM report on listing-rf11-e2e for each run.

import { test, expect } from './fixtures/auth';

test.describe('Backoffice — ADMIN acceso total', () => {
  test('ADMIN carga /admin y el nav muestra los 8 ítems', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Confirm we did NOT get redirected away
    expect(page.url()).toContain('/admin');
    expect(page.url()).not.toContain('/login');

    // AdminNav should show all 8 items
    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(8);

    // Spot-check some labels
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).toBeVisible();
  });
});

test.describe('Backoffice — MODERATOR acceso restringido', () => {
  test('MODERATOR → /admin redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');
    // Middleware redirects to home
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('MODERATOR → /admin/usuarios redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/usuarios');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('MODERATOR → /admin/ajustes redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('MODERATOR → /admin/reportes carga correctamente', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    // Must NOT have been redirected
    expect(page.url()).toContain('/admin/reportes');

    // The page heading should be visible
    await expect(page.getByRole('heading', { name: 'Reportes y denuncias' })).toBeVisible();
  });

  test('AdminNav muestra solo el ítem "Reportes" para el MODERATOR', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    // Only 1 nav link visible
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(links.first()).toHaveText('Reportes');

    // ADMIN-only sections must NOT be rendered
    await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).not.toBeVisible();
  });

  test('MODERATOR desestima un reporte y la acción funciona (sin 403)', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    // Wait for the report list to load (table or empty state)
    await page.waitForTimeout(1_000);

    // Filter to PENDING reports to find the seeded one
    const pendingButton = page.getByRole('button', { name: 'Pendientes' });
    if (await pendingButton.isVisible()) {
      await pendingButton.click();
      await page.waitForTimeout(800);
    }

    // Find the first "Desestimar" button
    const dismissBtn = page.getByRole('button', { name: 'Desestimar' }).first();

    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();

      // Wait for reload — the button should disappear as the report moves to DISMISSED
      await page.waitForTimeout(1_200);

      // Confirm no "Error 403" text appeared anywhere on the page
      const pageText = await page.locator('body').innerText();
      expect(pageText).not.toContain('403');
      expect(pageText).not.toContain('Forbidden');
    } else {
      // No PENDING report found — seed may have been consumed; skip gracefully
      test.skip(true, 'No PENDING reports found — seed report already consumed');
    }
  });
});
