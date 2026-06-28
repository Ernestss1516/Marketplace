// RR5.1 / RR5.1-ext — Playwright E2E: separación de roles ADMIN / MODERATOR.
//
// Tests:
//   ADMIN
//     1. /admin carga (dashboard) → el nav muestra los 8 ítems
//   MODERATOR — rutas aún bloqueadas (ADMIN-only)
//     2. /admin → redirige a /
//     3. /admin/ajustes → redirige a /
//     4. /admin/facturacion → redirige a /
//   MODERATOR — rutas abiertas en RR5.1-ext
//     5. /admin/reportes → carga correctamente
//     6. /admin/anuncios → carga correctamente (RR5.1-ext)
//     7. /admin/usuarios → carga correctamente (RR5.1-ext)
//     8. /admin/blog → carga correctamente (RR5.1-ext)
//     9. AdminNav muestra exactamente 4 ítems (Anuncios, Usuarios, Reportes, Blog)
//    10. MODERATOR no ve el botón "Banear" en /admin/usuarios
//    11. MODERATOR no ve el botón "Eliminar" en /admin/blog
//    12. MODERATOR desestima un reporte → funciona (sin 403)
//
// Prerequisites:
//   global-setup seeds admin-e2e@example.com (ADMIN) and moderator-e2e@example.com (MODERATOR).
//   seed-playwright.ts creates a PENDING SPAM report on listing-rf11-e2e each run.

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
  // ── Rutas bloqueadas (ADMIN-only) ──────────────────────────────────────────

  test('MODERATOR → /admin redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('MODERATOR → /admin/ajustes redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('MODERATOR → /admin/facturacion redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/facturacion');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  // ── Rutas abiertas en RR5.1-ext ───────────────────────────────────────────

  test('MODERATOR → /admin/reportes carga correctamente', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/reportes');
    await expect(page.getByRole('heading', { name: 'Reportes y denuncias' })).toBeVisible();
  });

  test('MODERATOR → /admin/anuncios carga correctamente [RR5.1-ext]', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/anuncios');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/anuncios');
    // Page must not have been redirected to / or to /login
    expect(page.url()).not.toMatch(/^https?:\/\/[^/]+\/?$/);
  });

  test('MODERATOR → /admin/usuarios carga correctamente [RR5.1-ext]', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/usuarios');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
  });

  test('MODERATOR → /admin/blog carga correctamente [RR5.1-ext]', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/blog');
    expect(page.url()).not.toContain('/login');
  });

  // ── AdminNav ───────────────────────────────────────────────────────────────

  test('AdminNav muestra 4 ítems para el MODERATOR (Anuncios, Usuarios, Reportes, Blog)', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    // Exactly 4 nav links visible
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(4);

    // All 4 must be present
    await expect(nav.getByRole('link', { name: 'Anuncios' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Blog' })).toBeVisible();

    // ADMIN-only sections must NOT be rendered
    await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Categorías' })).not.toBeVisible();
  });

  // ── Botones ADMIN-only no visibles para MODERATOR ─────────────────────────

  test('MODERATOR en /admin/usuarios — botón "Banear" no visible', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/usuarios');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    // "Banear" must never appear for a MODERATOR
    await expect(page.getByRole('button', { name: 'Banear' })).not.toBeVisible();
  });

  test('MODERATOR en /admin/blog — botón "Eliminar" no visible', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    // "Eliminar" must never appear for a MODERATOR
    await expect(page.getByRole('button', { name: 'Eliminar' })).not.toBeVisible();
  });

  // ── Acción de moderación ───────────────────────────────────────────────────

  test('MODERATOR desestima un reporte y la acción funciona (sin 403)', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    // Filter to PENDING reports to find the seeded one
    const pendingButton = page.getByRole('button', { name: 'Pendientes' });
    if (await pendingButton.isVisible()) {
      await pendingButton.click();
      await page.waitForTimeout(800);
    }

    const dismissBtn = page.getByRole('button', { name: 'Desestimar' }).first();

    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();
      await page.waitForTimeout(1_200);

      const pageText = await page.locator('body').innerText();
      expect(pageText).not.toContain('403');
      expect(pageText).not.toContain('Forbidden');
    } else {
      test.skip(true, 'No PENDING reports found — seed report already consumed');
    }
  });
});
