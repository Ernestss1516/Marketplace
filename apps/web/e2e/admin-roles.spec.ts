// RR5.1 / RR5.1-ext / BLOG-EDITOR — Playwright E2E: separación de roles ADMIN / MODERATOR / EDITOR.
//
// Tests:
//   ADMIN
//     1. /admin carga (dashboard) → el nav muestra los 10 ítems (+Banners, H8 Bloque D fase 4)
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
//   EDITOR — rol nuevo, acotado exclusivamente al blog (contenido reversible)
//    13. /admin/blog → carga correctamente
//    14. /admin/blog/nuevo → carga correctamente
//    15. /admin → redirige a /
//    16-22. /admin/{usuarios,facturacion,categorias,reportes,cupones,banners,ajustes,anuncios} → redirige a /
//    23. AdminNav muestra exactamente 1 ítem (Blog)
//    24. EDITOR no ve el botón "Eliminar" en /admin/blog (borrado físico ADMIN-only)
//
// Prerequisites:
//   global-setup seeds admin-e2e@example.com (ADMIN), moderator-e2e@example.com (MODERATOR)
//   y editor-e2e@example.com (EDITOR).
//   seed-playwright.ts creates a PENDING SPAM report on listing-rf11-e2e each run.

import { test, expect } from './fixtures/auth';

test.describe('Backoffice — ADMIN acceso total', () => {
  test('ADMIN carga /admin y el nav muestra los 10 ítems', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Confirm we did NOT get redirected away
    expect(page.url()).toContain('/admin');
    expect(page.url()).not.toContain('/login');

    // AdminNav should show all 10 items (H8 Bloque D fase 4 added "Banners")
    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(10);

    // Spot-check some labels
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cupones' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Banners' })).toBeVisible();
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

test.describe('Backoffice — EDITOR acotado exclusivamente al blog', () => {
  // ── Rutas abiertas ───────────────────────────────────────────────────────────

  test('EDITOR → /admin/blog carga correctamente', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/blog');
    expect(page.url()).not.toContain('/login');
  });

  test('EDITOR → /admin/blog/nuevo carga correctamente', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog/nuevo');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/blog/nuevo');
    expect(page.url()).not.toContain('/login');
  });

  // ── Rutas bloqueadas — TODO lo que no es blog ─────────────────────────────────

  test('EDITOR → /admin redirige a /', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  const BLOCKED_PATHS = [
    '/admin/usuarios',
    '/admin/facturacion',
    '/admin/categorias',
    '/admin/reportes',
    '/admin/cupones',
    '/admin/banners',
    '/admin/ajustes',
    '/admin/anuncios',
  ];

  for (const blockedPath of BLOCKED_PATHS) {
    test(`EDITOR → ${blockedPath} redirige a /`, async ({ editorContext }) => {
      const page = await editorContext.newPage();
      await page.goto(blockedPath);
      await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
      expect(page.url()).not.toContain('/admin');
    });
  }

  // ── AdminNav ───────────────────────────────────────────────────────────────

  test('AdminNav muestra exactamente 1 ítem para EDITOR (Blog)', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    const links = nav.getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Blog' })).toBeVisible();

    // Ningún otro ítem debe renderizarse
    await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Anuncios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Categorías' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cupones' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Banners' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).not.toBeVisible();
  });

  // ── Botón ADMIN-only no visible para EDITOR ───────────────────────────────────

  test('EDITOR en /admin/blog — botón "Eliminar" no visible (borrado físico ADMIN-only)', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await expect(page.getByRole('button', { name: 'Eliminar' })).not.toBeVisible();
  });
});
