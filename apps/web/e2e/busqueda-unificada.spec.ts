/**
 * BÚSQUEDA+TAGS — RÁFAGA A2: unificación de /busqueda y /[categoria].
 *
 * EL TEST CENTRAL es "LA TRAMPA": desde RÁFAGA 1 el backend RECHAZA con 400 cualquier
 * query param que no sea filtrable EN LA CATEGORÍA PEDIDA (defensa anti-leak
 * cross-categoría). Arrastrar la query tal cual al cambiar de categoría rompe la
 * página. A2 filtra en CLIENTE antes de navegar; el 400 del backend no se toca.
 *
 * Datos del seed que se usan (apps/api/prisma/seed-test.ts):
 *   electronica → moviles : brand, ram
 *   vehiculos   → coches  : brand (propio) + year, km (heredados)
 * Así que `ram` vale en móviles y NO en coches, y `km` vale en coches y NO en móviles:
 * los dos sentidos de la trampa con datos reales.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { loginAdminViaApi, authedPost } from './helpers/api';

const CATEGORIA = 'Categoría';

/**
 * Elige una categoría en el selector y espera a que la navegación aterrice.
 *
 * Se espera a que cambie el PATH, no a `networkidle`: el push del router puede no haber
 * aterrizado cuando la red se calma, y entonces `page.url()` devuelve la de antes
 * (visto como flake intermitente). El destino es la ruta canónica de la categoría, o
 * /busqueda cuando se elige "Todas".
 *
 * `waitUntil: 'commit'` es imprescindible: por defecto `waitForURL` espera ADEMÁS al
 * evento `load`, que una navegación de cliente del App Router no dispara — la URL casa
 * y el wait se queda colgado hasta el timeout.
 */
async function elegirCategoria(page: Page, valor: string) {
  const origen = new URL(page.url()).pathname;
  await page.getByLabel(CATEGORIA).selectOption(valor);
  await page.waitForURL((url) => url.pathname !== origen, { waitUntil: 'commit' });
  await page.waitForLoadState('networkidle');
}

/** La página ha renderizado resultados de verdad (ni error ni 400). */
async function esperarPaginaSana(page: Page) {
  await expect(page.getByRole('heading', { name: 'Algo salió mal' })).toHaveCount(0);
  await expect(page.getByLabel('Filtros')).toBeVisible();
}

test.describe('A2 — unificación de búsqueda', () => {
  // ── LA TRAMPA ─────────────────────────────────────────────────────────────
  test('global → categoría: el atributo ajeno se CAE; sin 400 y la página renderiza', async ({ page }) => {
    // `ram` es de móviles. En /busqueda vale (sin categoría, la unión global lo acepta);
    // en coches NO existe, así que arrastrarlo daría 400.
    await page.goto('/busqueda?q=golf&ram=8&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    // Lo que define A2: el atributo ajeno no ha viajado.
    expect(url.searchParams.has('ram')).toBe(false);

    // Y la página está viva — no un 400 ni el error boundary.
    await esperarPaginaSana(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Coches');
  });

  test('categoría → otra categoría: también se cae lo que no aplica en el destino', { tag: '@2b' }, async ({ page }) => {
    // `km` se hereda de vehículos, así que vale en coches pero no en móviles.
    await page.goto('/vehiculos/coches?km=100000&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'moviles');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/electronica/moviles');
    expect(url.searchParams.has('km')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  // ── El caso que YA era seguro (herencia): no debe perder nada ──────────────
  test('padre → hija: el atributo heredado SÍ se conserva', async ({ page }) => {
    await page.goto('/vehiculos?km=100000');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('km')).toBe('100000');
    await esperarPaginaSana(page);
  });

  test('hija → padre: un atributo de la hija sigue valiendo en el padre', async ({ page }) => {
    // Navegar el padre mezcla los anuncios de las hijas (categoryPath), así que un
    // atributo de hija es filtro legítimo ahí.
    await page.goto('/vehiculos/coches?brand=Seat');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'vehiculos');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos');
    expect(url.searchParams.get('brand')).toBe('Seat');
    await esperarPaginaSana(page);
  });

  // ── A4 — los rangos viajan como su atributo base ──────────────────────────
  test('A4: el rango sobrevive al cambiar a una categoría donde su atributo vale', async ({ page }) => {
    // `km` es de vehículos y lo heredan sus hijas, así que vale en las dos puntas de
    // este salto. (El seed de test solo tiene vehiculos→coches, así que el tránsito
    // que lo ejerce con datos reales es hija→padre.)
    await page.goto('/vehiculos/coches?km_min=50000&km_max=150000');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'vehiculos');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos');
    expect(url.searchParams.get('km_min')).toBe('50000');
    expect(url.searchParams.get('km_max')).toBe('150000');
    await esperarPaginaSana(page);
  });

  test('A4: el rango se CAE, sin 400, si su atributo no vale en el destino', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?km_min=50000&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'moviles');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/electronica/moviles');
    expect(url.searchParams.has('km_min')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  // ── Tránsito inverso ──────────────────────────────────────────────────────
  test('categoría → "Todas las categorías": vuelve a /busqueda conservando los filtros', async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, '');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/busqueda');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    await esperarPaginaSana(page);
  });

  test('el selector marca la categoría en la que estás', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    await expect(page.getByLabel(CATEGORIA)).toHaveValue('coches');

    await page.goto('/busqueda');
    await expect(page.getByLabel(CATEGORIA)).toHaveValue('');
  });

  test('el selector ofrece TODO el árbol desde la ruta de categoría (antes solo bajaba un nivel)', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    const select = page.getByLabel(CATEGORIA);

    await expect(select.locator('option', { hasText: 'Todas las categorías' })).toHaveCount(1);
    // Otra rama del árbol: inalcanzable con el viejo selector de "Subcategoría".
    await expect(select.locator('option', { hasText: 'Móviles' })).toHaveCount(1);
    // Y el viejo control ya no existe.
    await expect(page.getByText('Subcategoría')).toHaveCount(0);
  });

  test('`page` se descarta al cambiar de categoría', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/busqueda?page=3&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  });

  // ── P3: /busqueda?category= redirige ──────────────────────────────────────
  test('/busqueda?category=X redirige permanentemente a la ruta canónica', async ({ request }) => {
    const res = await request.get('/busqueda?category=coches', { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toBe('/vehiculos/coches');
  });

  test('/busqueda?category=X preserva el resto de la query y quita `category`', async ({ request }) => {
    const res = await request.get('/busqueda?category=coches&q=golf&province=Madrid', { maxRedirects: 0 });
    expect(res.status()).toBe(308);

    const url = new URL(res.headers()['location'], 'http://localhost:3000');
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    expect(url.searchParams.has('category')).toBe(false);
  });

  test('/busqueda sin category sigue siendo la búsqueda global, sin redirect', async ({ request }) => {
    expect((await request.get('/busqueda?q=golf', { maxRedirects: 0 })).status()).toBe(200);
  });

  // ── `q` formalizado en la ruta de categoría ───────────────────────────────
  test('q se ve en el <h1> de la categoría (antes filtraba en silencio)', async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('resultados para "golf"');
  });

  test('q llega al <title>', async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await expect(page).toHaveTitle(/golf/);
  });

  test('"Limpiar filtros" CONSERVA q — antes lo borraba', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await page.getByRole('button', { name: 'Limpiar filtros' }).first().click();
    // Se espera a la URL concreta, no a `networkidle`: el push del router puede
    // no haber aterrizado cuando la red se calma, y leer page.url() entonces
    // devuelve la de antes (visto: `province` seguía puesto en ~1 de cada 10).
    await page.waitForURL((url) => !url.searchParams.has('province'), { waitUntil: 'commit' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.has('province')).toBe(false);
  });

  test('q sobrevive al cambiar de categoría', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'moviles');

    expect(new URL(page.url()).searchParams.get('q')).toBe('golf');
  });
});

// ── `condition` al saltar a una categoría solo-servicio ─────────────────────
// Necesita una categoría SERVICE_ONLY, que el seed no trae: se crea por la API de
// admin (mismo patrón que producto-servicio-flujo.spec.ts) y se borra al terminar,
// para no dejar más residuo en la base compartida del que ya arrastra.
test.describe('A2 — condition no viaja a una categoría de servicios', () => {
  let adminToken: string;
  let svcId: string;
  let svcSlug: string;

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAdminViaApi(request, 'admin-e2e@example.com', 'Test1234!');
    svcSlug = `a2-svc-${Date.now()}`;
    const res = await authedPost(request, '/admin/categories', adminToken, {
      name: 'A2 Solo Servicios',
      slug: svcSlug,
      allowedListingType: 'SERVICE_ONLY',
      attributeSchema: [],
    });
    if (res.status() !== 201) {
      throw new Error(`[A2 setup] no se pudo crear la categoría: ${res.status()} ${await res.text()}`);
    }
    svcId = (await res.json()).id as string;
  });

  test.afterAll(async ({ request }: { request: APIRequestContext }) => {
    if (svcId) {
      await request.delete(`http://localhost:3001/api/admin/categories/${svcId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });

  test('al elegir una categoría SERVICE_ONLY, `condition` se descarta y el resto se conserva', async ({ page }) => {
    // Un servicio no tiene estado de conservación: arrastrar `condition` dejaría un
    // filtro activo, invisible (el panel lo oculta en contexto de servicio) y
    // restrictivo.
    await page.goto('/vehiculos/coches?condition=NEW&q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, svcSlug);

    const url = new URL(page.url());
    expect(url.pathname).toBe(`/${svcSlug}`);
    expect(url.searchParams.has('condition')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    await esperarPaginaSana(page);
  });

  test('hacia una categoría que admite productos, `condition` SÍ se conserva (el contraste)', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/electronica/moviles?condition=NEW');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    expect(new URL(page.url()).searchParams.get('condition')).toBe('NEW');
  });
});
