// RR5.1 / RR5.1-ext / BLOG-EDITOR — Playwright E2E: separación de roles ADMIN / MODERATOR / EDITOR.
//
// Tests:
//   ADMIN
//     1. /admin carga (dashboard) → el nav muestra los 17 ítems (+Páginas BLOG-PAGINAS,
//        +Patrocinados H6.6, +Footer R.3, +Mensajes de contacto RC.2)
//   MODERATOR — rutas aún bloqueadas (ADMIN-only)
//     2. /admin → redirige a /
//     3. /admin/ajustes → redirige a /
//     4. /admin/facturacion → redirige a /
//   MODERATOR — rutas abiertas en RR5.1-ext
//     5. /admin/reportes → carga correctamente
//     6. /admin/anuncios → carga correctamente (RR5.1-ext)
//     7. /admin/usuarios → carga correctamente (RR5.1-ext)
//     8. /admin/blog → carga correctamente (RR5.1-ext)
//     8b. /admin/paginas → carga correctamente (BLOG-PAGINAS)
//     9. AdminNav muestra exactamente 5 ítems (Anuncios, Usuarios, Reportes, Blog, Páginas)
//    10. MODERATOR no ve el botón "Banear" en /admin/usuarios
//    11. MODERATOR no ve el botón "Eliminar" en /admin/blog
//    12. MODERATOR desestima un reporte → funciona (sin 403)
//   EDITOR — rol nuevo, acotado exclusivamente al blog (contenido reversible)
//    13. /admin/blog → carga correctamente
//    14. /admin/blog/nuevo → carga correctamente
//    14b. /admin/paginas → carga correctamente (BLOG-PAGINAS)
//    15. /admin → redirige a /
//    16-22. /admin/{usuarios,facturacion,categorias,reportes,cupones,banners,ajustes,anuncios} → redirige a /
//    23. AdminNav muestra exactamente 2 ítems (Blog, Páginas)
//    24. EDITOR no ve el botón "Eliminar" en /admin/blog (borrado físico ADMIN-only)
//   BLOG-ADMIN-ROLE-UI — selector de asignación de rol en /admin/usuarios
//    25. ADMIN cambia el rol de role-target-e2e USER→EDITOR→MODERATOR→USER; cada cambio
//        se refleja en el selector Y en el acceso real del usuario tras re-login
//    26. El selector de rol no existe para usuarios ADMIN (solo el badge)
//
// Prerequisites:
//   global-setup seeds admin-e2e@example.com (ADMIN), moderator-e2e@example.com (MODERATOR)
//   y editor-e2e@example.com (EDITOR).
//   seed-playwright.ts creates a PENDING SPAM report on listing-rf11-e2e each run, and
//   resets role-target-e2e@example.com to role USER each run (target for the role-assignment test).

import { test, expect } from './fixtures/auth';
import type { Browser } from '@playwright/test';

// Logs in as an arbitrary user via the login UI — used to verify that a role change made
// through the /admin/usuarios selector actually takes effect for that user (new JWT on login).
async function loginAs(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // No waitUntil override here (default 'load'): 'domcontentloaded' can resolve
  // before React hydrates and attaches the form's submit handler, so clicking
  // the button falls through to a native HTML GET-form submission instead of the
  // SPA login flow — matches the proven-reliable pattern in global-setup.ts.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('Test1234!');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return page;
}

test.describe('Backoffice — ADMIN acceso total', () => {
  test('ADMIN carga /admin y el nav muestra los 17 ítems', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Confirm we did NOT get redirected away
    expect(page.url()).toContain('/admin');
    expect(page.url()).not.toContain('/login');

    // AdminNav should show all 14 items (BLOG-PAGINAS added "Páginas", H6.6 added
    // "Patrocinados", R.3 added "Footer", RC.2 added "Mensajes de contacto")
    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(17);

    // Spot-check some labels
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cupones' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Banners' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Patrocinados' })).toBeVisible();
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

  test('MODERATOR → /admin/paginas carga correctamente [BLOG-PAGINAS]', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/paginas');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/paginas');
    expect(page.url()).not.toContain('/login');
  });

  // ── AdminNav ───────────────────────────────────────────────────────────────

  test('AdminNav muestra 6 ítems para el MODERATOR (Anuncios, Usuarios, Reportes, Tickets, Blog, Páginas)', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    // Exactly 6 nav links visible (R7 de atención al usuario añade Tickets)
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(6);

    // All 6 must be present
    await expect(nav.getByRole('link', { name: 'Anuncios' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tickets' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Blog' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Páginas' })).toBeVisible();

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

  test('EDITOR → /admin/paginas carga correctamente [BLOG-PAGINAS]', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/paginas');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/paginas');
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

  test('AdminNav muestra exactamente 2 ítems para EDITOR (Blog, Páginas)', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    const links = nav.getByRole('link');
    await expect(links).toHaveCount(2);
    await expect(nav.getByRole('link', { name: 'Blog' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Páginas' })).toBeVisible();

    // Ningún otro ítem debe renderizarse
    await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Anuncios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).not.toBeVisible();
    // R7 — Tickets es de ADMIN+MODERATOR; el EDITOR no debe verlo.
    await expect(nav.getByRole('link', { name: 'Tickets' })).not.toBeVisible();
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

test.describe('Asignación de roles desde /admin/usuarios', () => {
  test('ADMIN cambia el rol de un usuario (USER → EDITOR → MODERATOR → USER) y el acceso real cambia en consecuencia', async ({
    adminContext,
    browser,
  }) => {
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/admin/usuarios', { waitUntil: 'domcontentloaded' });

    const searchInput = adminPage.getByPlaceholder(/buscar por nombre o email/i);
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill('Role Target E2E');
    await adminPage.getByRole('button', { name: 'Buscar' }).click();

    const row = adminPage.locator('tr', { hasText: 'Role Target E2E' });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const roleSelect = row.locator('select');
    await expect(roleSelect).toBeVisible();

    // USER → EDITOR: el usuario gana acceso a /admin/blog y a nada más.
    await roleSelect.selectOption('EDITOR');
    await expect(roleSelect).toHaveValue('EDITOR', { timeout: 5_000 });

    const editorPage = await loginAs(browser, 'role-target-e2e@example.com');
    await editorPage.goto('/admin/blog', { waitUntil: 'domcontentloaded' });
    expect(editorPage.url()).toContain('/admin/blog');
    await editorPage.goto('/admin/usuarios', { waitUntil: 'domcontentloaded' });
    await editorPage.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(editorPage.url()).not.toContain('/admin');
    await editorPage.close();

    // EDITOR → MODERATOR: gana reportes/anuncios/usuarios/blog, sigue sin ajustes.
    await roleSelect.selectOption('MODERATOR');
    await expect(roleSelect).toHaveValue('MODERATOR', { timeout: 5_000 });

    const moderatorPage = await loginAs(browser, 'role-target-e2e@example.com');
    await moderatorPage.goto('/admin/reportes', { waitUntil: 'domcontentloaded' });
    expect(moderatorPage.url()).toContain('/admin/reportes');
    await moderatorPage.goto('/admin/ajustes', { waitUntil: 'domcontentloaded' });
    await moderatorPage.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(moderatorPage.url()).not.toContain('/admin');
    await moderatorPage.close();

    // MODERATOR → USER: pierde todo acceso a /admin/*. Deja el fixture en su estado
    // inicial para que el siguiente run del test sea repetible sin depender del seed.
    await roleSelect.selectOption('USER');
    await expect(roleSelect).toHaveValue('USER', { timeout: 5_000 });

    const userPage = await loginAs(browser, 'role-target-e2e@example.com');
    await userPage.goto('/admin', { waitUntil: 'domcontentloaded' });
    await userPage.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(userPage.url()).not.toContain('/admin');
    await userPage.close();
  });

  test('el selector de rol no existe para usuarios ADMIN (solo el badge)', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/usuarios', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder(/buscar por nombre o email/i);
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill('Admin E2E');
    await page.getByRole('button', { name: 'Buscar' }).click();

    const row = page.locator('tr', { hasText: 'Admin E2E' });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('select')).toHaveCount(0);
    await expect(row.getByText('Admin', { exact: true })).toBeVisible();
  });
});
