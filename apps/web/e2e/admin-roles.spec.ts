// ROLES — Playwright E2E: el REPARTO del backoffice entre EDITOR / MODERATOR / ADMIN.
//
// ─── EL REPARTO QUE ESTE FICHERO PINZA (ráfaga R2) ────────────────────────────
//
//   EDITOR (7)      dashboard, blog, páginas, portada, footer, navegación, banners
//                   — contenido y presentación del sitio público.
//   MODERATOR (19)  lo de EDITOR + anuncios, cola de revisión, usuarios, reportes,
//                   tickets, categorías, tags, campañas, cupones, patrocinados,
//                   mensajes de contacto, motivos de contacto.
//   ADMIN (22)      todo + facturación, facturas, ajustes.
//   USER            nada.
//
// LA FUENTE DE VERDAD ES `src/config/backoffice-sections.ts`, un solo fichero del
// que derivan el middleware y el nav (ráfaga R1). Este fichero comprueba el
// resultado en el navegador; el reparto sección por sección lo pinza además
// `backoffice-sections.test.ts`, que compara el mapa contra la tabla acordada.
//
// POR QUÉ SE CUENTAN LOS ÍTEMS, sabiendo que es frágil. Un conteo exacto se rompe
// al añadir una sección aunque el backoffice esté perfecto — el comentario que
// vivía aquí ya lo advertía y proponía comprobar sólo presencia. Se conserva el
// conteo a propósito: es lo único que detecta una sección que se COLARA en el nav
// de un rol que no debe verla, y ese es justamente el fallo que un reparto en tres
// pisos puede introducir sin que nadie lo note. La fragilidad es el precio, y el
// arreglo cuando se añada una sección es una línea.
//
// ─── INVARIANTE DE CARGA (INV-1) ──────────────────────────────────────────────
//
// Abrir una sección a un rol NO basta: los endpoints que esa sección llama para
// pintarse tienen que admitir el mismo piso, o la página carga y falla con 403 —
// el peor de los dos mundos, porque el nav promete algo que no se puede usar. No
// es comprobable de forma declarativa (nadie declara qué llama cada pantalla), así
// que se comprueba por COMPORTAMIENTO: el bloque «INV-1» de abajo abre cada
// sección que ha bajado de piso con su rol nuevo y exige que no aparezca ningún
// error de autorización.
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
  test('ADMIN carga /admin y el nav muestra las 22 secciones', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Confirm we did NOT get redirected away
    expect(page.url()).toContain('/admin');
    expect(page.url()).not.toContain('/login');

    // 22 = todas las filas de BACKOFFICE_SECTIONS. Eran 21 hasta R2, y la que
    // faltaba no es nueva: `/admin/motivos-contacto` existía y era alcanzable,
    // pero nadie le había puesto entrada en `NAV_ITEMS` (hallazgo R3 de la
    // auditoría). Con el nav derivado del mapa, tener fila ES tener ítem.
    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(22);

    // Un ADMIN ve lo suyo Y lo de los otros dos pisos.
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturas' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Motivos de contacto' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Patrocinados' })).toBeVisible();
  });
});

test.describe('Backoffice — MODERATOR acceso restringido', () => {
  // ── Rutas bloqueadas: sólo quedan las TRES de ADMIN ────────────────────────
  //
  // Hasta R2 aquí también estaba `/admin` (el dashboard), que ahora es EDITOR+ y
  // por tanto carga para un MODERATOR — ver el bloque INV-1.

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

  test('MODERATOR → /admin/facturas redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/facturas');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  // ── Rutas abiertas ────────────────────────────────────────────────────────

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

  test('AdminNav muestra las 19 secciones del MODERATOR, y ninguna de las 3 de ADMIN', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/reportes');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    // 19 = 22 totales − las 3 de ADMIN. Eran 7 hasta R2.
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(19);

    // Las 12 que gana en R2, una por una: sin esto, el conteo de 19 pasaría igual
    // aunque la sección equivocada se hubiera colado en el reparto.
    for (const label of [
      'Dashboard',
      'Portada',
      'Footer',
      'Navegación',
      'Banners',
      'Categorías',
      'Tags',
      'Campañas',
      'Cupones',
      'Patrocinados',
      'Mensajes de contacto',
      'Motivos de contacto',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Y las 7 que ya tenía siguen ahí.
    for (const label of [
      'Anuncios',
      'Cola de revisión',
      'Usuarios',
      'Reportes',
      'Tickets',
      'Blog',
      'Páginas',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Las 3 de ADMIN NO se pintan: el dinero y la configuración de plataforma.
    await expect(nav.getByRole('link', { name: 'Ajustes' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturas' })).not.toBeVisible();
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

test.describe('Backoffice — EDITOR: contenido y presentación del sitio', () => {
  // R2 — el EDITOR deja de estar acotado al blog. Su oficio pasa a ser toda la
  // superficie editorial del sitio público: qué se enseña (portada, banners) y
  // cómo se navega (footer, navegación), además del contenido (blog, páginas) y
  // el dashboard. Lo que NO toca sigue siendo todo lo de moderar y el dinero.

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

  // ── Rutas bloqueadas — lo de moderar y lo de ADMIN ────────────────────────────
  //
  // `/admin` y `/admin/banners` SALEN de esta lista en R2: el dashboard y los
  // banners pasan a EDITOR. Los siete que quedan son de MODERATOR o de ADMIN.

  const BLOCKED_PATHS = [
    '/admin/usuarios',
    '/admin/facturacion',
    '/admin/categorias',
    '/admin/reportes',
    '/admin/cupones',
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

  test('AdminNav muestra las 7 secciones del EDITOR, y ninguna más', async ({ editorContext }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/blog');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    const links = nav.getByRole('link');
    await expect(links).toHaveCount(7);

    for (const label of [
      'Dashboard',
      'Blog',
      'Páginas',
      'Portada',
      'Footer',
      'Navegación',
      'Banners',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Nada de moderar ni de ADMIN.
    await expect(nav.getByRole('link', { name: 'Anuncios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tickets' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Categorías' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Patrocinados' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Facturación' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cupones' })).not.toBeVisible();
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

// ─────────────────────────────────────────────────────────────────────────────
// INV-1 — LAS SECCIONES QUE BAJARON CARGAN DE VERDAD CON SU ROL NUEVO
//
// Es la mitad del reparto que el mapa NO puede garantizar por sí solo. Abrir la
// ruta a un rol lo decide `backoffice-sections.ts`; que la página se pinte
// depende de que los endpoints que llama admitan ese mismo piso, y sección y
// endpoint no son 1:1 (una sección puede llamar a varios, y un controlador puede
// servir a varias secciones). Por eso esto se comprueba cargando, no leyendo.
//
// Lo que se afirma es doble: que NO redirige (el mapa) y que la pantalla no
// muestra un error de autorización (los @MinRole del backend). Sin la segunda
// mitad, un 403 dejaría al usuario en una sección que el nav le prometió — el
// caso concreto que este bloque existe para atrapar es `GET /admin/stats`, que
// heredaba ADMIN mientras el dashboard bajaba a EDITOR.
// ─────────────────────────────────────────────────────────────────────────────

/** Un error de autorización visible en la pantalla, venga como venga pintado. */
async function sinErrorDeAutorizacion(page: import('@playwright/test').Page) {
  const texto = (await page.locator('body').innerText()).toLowerCase();
  expect(texto).not.toContain('error 403');
  expect(texto).not.toContain('error 401');
  expect(texto).not.toContain('forbidden');
  expect(texto).not.toContain('unauthorized');
}

test.describe('INV-1 — las secciones que bajaron cargan sin 403', () => {
  // Las 5 que bajan hasta EDITOR (el dashboard es la que obligó a bajar
  // `GET /admin/stats`; las otras cuatro, la clase entera de su controlador).
  const PARA_EDITOR = ['/admin', '/admin/portada', '/admin/footer', '/admin/nav', '/admin/banners'];

  for (const ruta of PARA_EDITOR) {
    test(`EDITOR carga ${ruta} sin error de autorización`, async ({ editorContext }) => {
      const page = await editorContext.newPage();
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(ruta);
      await sinErrorDeAutorizacion(page);
    });
  }

  // Las 7 que bajan hasta MODERATOR. `categorias` y `tags` son las que obligaron
  // a tocar los 7 métodos de AdminController y las 2 clases de admin-tags.
  const PARA_MODERATOR = [
    '/admin/categorias',
    '/admin/tags',
    '/admin/campaigns',
    '/admin/cupones',
    '/admin/sponsored-ads',
    '/admin/mensajes-contacto',
    '/admin/motivos-contacto',
  ];

  for (const ruta of PARA_MODERATOR) {
    test(`MODERATOR carga ${ruta} sin error de autorización`, async ({ moderatorContext }) => {
      const page = await moderatorContext.newPage();
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(ruta);
      await sinErrorDeAutorizacion(page);
    });
  }

  // Y el dashboard con el rol intermedio: hereda el piso de EDITOR por la escalera.
  test('MODERATOR carga /admin (dashboard) sin error de autorización', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin');
    await sinErrorDeAutorizacion(page);
  });
});

test.describe('ENMIENDA A M4 — la marca de revisión de una categoría es del MODERATOR', () => {
  // El eje de la enmienda: una RAMA del catálogo la decide quien modera; una
  // PERSONA sigue siendo ADMIN. Ver docs/diseno-roles.md §5 y el comentario largo
  // de `updateCategory` en admin.controller.ts.

  test('un MODERATOR abre /admin/categorias y ve el control de revisión previa', async ({
    moderatorContext,
  }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/categorias');
    await sinErrorDeAutorizacion(page);

    // El árbol se pinta con GET /admin/categories, que ha bajado a MODERATOR: si
    // siguiera en ADMIN esto estaría vacío y la pantalla mostraría el error.
    await expect(page.getByRole('heading', { name: /categor/i }).first()).toBeVisible();
  });

  test('un MODERATOR NO puede marcar a un VENDEDOR para revisión (sigue siendo ADMIN)', async ({
    moderatorContext,
  }) => {
    // La otra mitad de la enmienda, y la que evita que se lea como «moderación
    // puede con todo»: el botón de /admin/usuarios sigue oculto para MODERATOR.
    const page = await moderatorContext.newPage();
    await page.goto('/admin/usuarios');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await expect(page.getByRole('button', { name: 'Revisar' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'No revisar' })).not.toBeVisible();
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

  // ───────────────────────────────────────────────────────────────────────────
  // ROLES R3 — EL CÍRCULO COMPLETO, con una sesión YA ABIERTA.
  //
  // El test de arriba vuelve a loguearse después de cada cambio de rol, así que
  // nunca ejercita el caso que importaba: alguien que YA ESTÁ dentro del
  // backoffice cuando le cambian el rol. Ése era el defecto R1 de la auditoría —
  // el frontend guarda el rol en la cookie y sólo lo escribe al iniciar sesión,
  // así que el middleware seguía abriéndole el panel con el rol viejo mientras la
  // API le respondía 403 a todo: veía el backoffice y no le funcionaba nada.
  //
  // Se afirman las DOS mitades de la ráfaga, porque una sin la otra es peor que
  // ninguna: que la sesión muera (backend, `tokenVersion`) y que eso se convierta
  // en una vuelta al login y NO en una pantalla de «Error 401» (frontend,
  // `AdminSessionGuard`). Antes de R3 no había ni una ni otra.
  // ───────────────────────────────────────────────────────────────────────────
  test('cambiar el rol a alguien que está DENTRO del backoffice lo devuelve al login, no a un Error 401', async ({
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

    // 1) Se le da un rol con backoffice y entra de verdad.
    await roleSelect.selectOption('MODERATOR');
    await expect(roleSelect).toHaveValue('MODERATOR', { timeout: 5_000 });

    const victimaPage = await loginAs(browser, 'role-target-e2e@example.com');
    await victimaPage.goto('/admin/anuncios', { waitUntil: 'domcontentloaded' });
    await victimaPage.waitForLoadState('networkidle');
    expect(victimaPage.url()).toContain('/admin/anuncios');

    // 2) El ADMIN se lo quita mientras la otra sesión sigue abierta.
    await roleSelect.selectOption('USER');
    await expect(roleSelect).toHaveValue('USER', { timeout: 5_000 });

    // 3) La siguiente acción de la víctima en el backoffice. Su cookie todavía
    //    dice MODERATOR, así que el middleware la deja pasar; lo que ya no vale
    //    es su accessToken, y la primera llamada a la API devuelve 401.
    await victimaPage.reload({ waitUntil: 'domcontentloaded' });

    // 4) El desenlace contratado: vuelve al login, con la ruta que pedía como
    //    callbackUrl. Sin AdminSessionGuard se quedaría en /admin/anuncios
    //    mirando el texto del error.
    await victimaPage.waitForURL((url) => url.pathname === '/login', { timeout: 20_000 });
    expect(victimaPage.url()).toContain('callbackUrl');

    // 5) Y no ha visto en ningún momento el error crudo.
    const texto = (await victimaPage.locator('body').innerText()).toLowerCase();
    expect(texto).not.toContain('error 401');
    expect(texto).not.toContain('session invalidated');

    // 6) Al volver a entrar, el rol es el NUEVO: el backoffice ya no es suyo.
    await victimaPage.close();
    const relogueada = await loginAs(browser, 'role-target-e2e@example.com');
    await relogueada.goto('/admin/anuncios', { waitUntil: 'domcontentloaded' });
    await relogueada.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(relogueada.url()).not.toContain('/admin');
    await relogueada.close();
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
