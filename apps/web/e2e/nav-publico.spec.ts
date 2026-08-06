// NAV PRINCIPAL (RN.3) — la barra configurable bajo el header en (public).
//
// Cubre los cuatro casos que el diseño fija para esta ráfaga
// (docs/diseno-nav-dinamico.md §8, RN.3):
//   1. barra AUSENTE sin datos (gate total: ni <nav>, ni contenedor, ni borde);
//   2. barra presente con datos, con el href ya resuelto por el backend;
//   3. desplegable operable con TECLADO (por eso es Radix y no CSS-only);
//   4. un tipo de página que oculta un nodo (visibleOn).
//
// ── Por qué UNA fase de escritura y luego solo lecturas ─────────────────────
// El nav se sirve desde `unstable_cache` (tag 'main-nav', TTL 1 h) y la
// invalidación la dispara el backend de forma FIRE-AND-FORGET
// (RevalidateService lanza el fetch a /api/revalidate sin esperarlo). Entre la
// mutación y la invalidación efectiva hay una ventana real y de duración
// variable.
//
// Una primera versión de esta spec mutaba el árbol DENTRO de cada test y
// sondeaba después; salía intermitente, que es peor que roja. Aquí el árbol se
// monta UNA vez en beforeAll, se espera UNA vez a que la caché lo refleje, y
// los tests solo LEEN distintas páginas. El único test que necesita otro estado
// —el gate total, que exige el árbol vacío— vive en su propio describe al
// final, con su propia espera.
//
// El árbol se monta vía la API admin de RN.2: no hay UI de administración hasta
// RN.4. El nav es estado GLOBAL compartido con el resto de la batería (como el
// árbol de categorías o los ajustes), así que se deja vacío al terminar.
//
// Prerequisites: global-setup siembra admin-e2e@example.com (ADMIN).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAdminViaApi, authedGet, authedPost, authedDelete } from './helpers/api';

const ADMIN_EMAIL = 'admin-e2e@example.com';
const ADMIN_PASSWORD = 'Test1234!';

const BAR = 'nav[aria-label="Navegación principal"]';

async function adminToken(request: APIRequestContext): Promise<string> {
  return loginAdminViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/** Borra todos los nodos raíz; el cascade se lleva los submenús. */
async function clearNav(request: APIRequestContext, token: string): Promise<void> {
  const res = await authedGet(request, '/admin/nav', token);
  for (const root of (await res.json()) as { id: string }[]) {
    await authedDelete(request, `/admin/nav/items/${root.id}`, token);
  }
}

async function createItem(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await authedPost(request, '/admin/nav/items', token, data);
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Espera a que la página refleje el árbol recién escrito, RECARGANDO en cada
 * intento: reintentar solo la aserción no sirve de nada, porque `expect`
 * reconsulta el DOM de una página ya renderizada y esa página se pintó con lo
 * que hubiera en caché. Lo único que trae contenido nuevo es volver a pedirla —
 * mismo razonamiento que `esperarFooterPublico` en footer-admin.spec.ts.
 */
async function esperarNav(page: Page, path: string, cumple: (barras: number) => boolean): Promise<void> {
  await expect(async () => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const barras = await page.locator(BAR).count();
    if (!cumple(barras)) throw new Error(`la barra aún no refleja el cambio (barras=${barras})`);
  }).toPass({ timeout: 30_000 });
}

test.describe('Nav principal público — árbol configurado', () => {
  test.beforeAll(async ({ browser, request }) => {
    const token = await adminToken(request);
    await clearNav(request, token);

    await createItem(request, token, { label: 'Comprar', type: 'INTERNAL', url: '/busqueda', order: 0 });
    await createItem(request, token, {
      label: 'Sitio externo',
      type: 'EXTERNAL',
      url: 'https://example.com',
      order: 1,
    });
    const ayuda = await createItem(request, token, { label: 'Ayuda', order: 2 }); // sin destino
    await createItem(request, token, {
      label: 'Contacto',
      type: 'INTERNAL',
      url: '/contacto',
      parentId: ayuda,
      order: 0,
    });
    await createItem(request, token, {
      label: 'Solo en la home',
      type: 'INTERNAL',
      url: '/planes',
      order: 3,
      visibleOn: ['HOME'],
    });

    // Una sola espera a la consistencia eventual, en una página desechable.
    const warmup = await browser.newPage();
    await esperarNav(warmup, '/', (n) => n === 1);
    await warmup.close();
  });

  test.afterAll(async ({ request }) => {
    await clearNav(request, await adminToken(request));
  });

  test('la barra aparece bajo el header, con los href ya resueltos por el backend', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator(BAR);
    await expect(nav).toBeVisible();

    await expect(nav.getByRole('link', { name: 'Comprar' })).toHaveAttribute('href', '/busqueda');

    // external → pestaña nueva con rel=noopener (igual que en el footer).
    const externo = nav.getByRole('link', { name: 'Sitio externo' });
    await expect(externo).toHaveAttribute('target', '_blank');
    await expect(externo).toHaveAttribute('rel', /noopener/);

    // La barra va DEBAJO del header, nunca encima ni dentro.
    const headerBox = (await page.locator('header').first().boundingBox())!;
    const navBox = (await nav.boundingBox())!;
    expect(navBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);

    // Un enlace interno navega por el router del App Router.
    await nav.getByRole('link', { name: 'Comprar' }).click();
    await page.waitForURL(/\/busqueda/);
  });

  test('el desplegable se abre y se cierra con TECLADO (Radix, no hover CSS)', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator(BAR).getByRole('button', { name: 'Ayuda' });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Cerrado, el hijo no está en el DOM: Radix monta el contenido al abrir.
    await expect(page.getByRole('menuitem', { name: 'Contacto' })).toHaveCount(0);

    // Abrir con TECLADO. Un desplegable CSS-only por hover no podría — es la
    // razón de usar Radix y no `group-hover`.
    await trigger.focus();
    await page.keyboard.press('Enter');

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'Contacto' })).toBeVisible();

    // Con modal={false} el resto de la página sigue en el árbol de
    // accesibilidad mientras el menú está abierto: un menú de navegación no
    // deja el sitio inerte.
    await expect(page.locator('header').first()).toBeVisible();

    // Escape cierra y devuelve el foco al disparador.
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('visibleOn oculta un nodo en los tipos de página que no lista', async ({ page }) => {
    const nav = page.locator(BAR);

    // HOME: se ve el nodo restringido.
    await page.goto('/');
    await expect(nav.getByRole('link', { name: 'Solo en la home' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Comprar' })).toBeVisible();

    // /busqueda es NavPageType.BUSQUEDA: desaparece el restringido, no el resto.
    await page.goto('/busqueda');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Solo en la home' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Comprar' })).toBeVisible();
  });

  test('la misma barra se hereda en las demás ramas de (public)', async ({ page }) => {
    // Prueba de que los layouts anidados cubren cada rama: si a una le faltara
    // el suyo, la barra no saldría ahí y el fallo sería SILENCIOSO en producción.
    for (const path of ['/contacto', '/planes', '/blog']) {
      await page.goto(path);
      await expect(page.locator(BAR), `sin barra en ${path}`).toBeVisible();
      await expect(page.locator(BAR).getByRole('link', { name: 'Comprar' })).toBeVisible();
    }
  });
});

test.describe('Nav principal público — sin configurar', () => {
  test.afterAll(async ({ request }) => {
    await clearNav(request, await adminToken(request));
  });

  test('sin nav configurado no se pinta NADA (gate total) y el header sigue intacto', async ({
    page,
    request,
  }) => {
    await clearNav(request, await adminToken(request));

    // Ni la barra ni un contenedor vacío con borde: MainNav devuelve null.
    await esperarNav(page, '/', (n) => n === 0);

    // El header público no se toca — es el requisito de convivencia del encargo.
    await expect(page.locator('header').first()).toBeVisible();
  });
});
