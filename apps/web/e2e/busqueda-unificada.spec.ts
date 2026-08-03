/**
 * BÃšSQUEDA+TAGS â€” RÃFAGA A2: unificaciÃ³n de /busqueda y /[categoria].
 *
 * EL TEST CENTRAL es "LA TRAMPA": desde RÃFAGA 1 el backend RECHAZA con 400 cualquier
 * query param que no sea filtrable EN LA CATEGORÃA PEDIDA (defensa anti-leak
 * cross-categorÃ­a). Arrastrar la query tal cual al cambiar de categorÃ­a rompe la
 * pÃ¡gina. A2 filtra en CLIENTE antes de navegar; el 400 del backend no se toca.
 *
 * Datos del seed que se usan (apps/api/prisma/seed-test.ts):
 *   electronica â†’ moviles : brand, ram
 *   vehiculos   â†’ coches  : brand (propio) + year, km (heredados)
 * AsÃ­ que `ram` vale en mÃ³viles y NO en coches, y `km` vale en coches y NO en mÃ³viles:
 * los dos sentidos de la trampa con datos reales.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { loginAdminViaApi, authedPost } from './helpers/api';

const CATEGORIA = 'CategorÃ­a';

/**
 * Elige una categorÃ­a en el selector y espera a que la navegaciÃ³n aterrice.
 *
 * Se espera a que cambie el PATH, no a `networkidle`: el push del router puede no haber
 * aterrizado cuando la red se calma, y entonces `page.url()` devuelve la de antes
 * (visto como flake intermitente). El destino es la ruta canÃ³nica de la categorÃ­a, o
 * /busqueda cuando se elige "Todas".
 *
 * `waitUntil: 'commit'` es imprescindible: por defecto `waitForURL` espera ADEMÃS al
 * evento `load`, que una navegaciÃ³n de cliente del App Router no dispara â€” la URL casa
 * y el wait se queda colgado hasta el timeout.
 */
async function elegirCategoria(page: Page, valor: string) {
  const origen = new URL(page.url()).pathname;
  await page.getByLabel(CATEGORIA).selectOption(valor);
  await page.waitForURL((url) => url.pathname !== origen, { waitUntil: 'commit' });
  await page.waitForLoadState('networkidle');
}

/** La pÃ¡gina ha renderizado resultados de verdad (ni error ni 400). */
async function esperarPaginaSana(page: Page) {
  await expect(page.getByRole('heading', { name: 'Algo saliÃ³ mal' })).toHaveCount(0);
  await expect(page.getByLabel('Filtros')).toBeVisible();
}

test.describe('A2 â€” unificaciÃ³n de bÃºsqueda', () => {
  // â”€â”€ LA TRAMPA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('global â†’ categorÃ­a: el atributo ajeno se CAE; sin 400 y la pÃ¡gina renderiza', { tag: '@2b' }, async ({ page }) => {
    // `ram` es de mÃ³viles. En /busqueda vale (sin categorÃ­a, la uniÃ³n global lo acepta);
    // en coches NO existe, asÃ­ que arrastrarlo darÃ­a 400.
    await page.goto('/busqueda?q=golf&ram=8&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    // Lo que define A2: el atributo ajeno no ha viajado.
    expect(url.searchParams.has('ram')).toBe(false);

    // Y la pÃ¡gina estÃ¡ viva â€” no un 400 ni el error boundary.
    await esperarPaginaSana(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Coches');
  });

  test('categorÃ­a â†’ otra categorÃ­a: tambiÃ©n se cae lo que no aplica en el destino', { tag: '@2b' }, async ({ page }) => {
    // `km` se hereda de vehÃ­culos, asÃ­ que vale en coches pero no en mÃ³viles.
    await page.goto('/vehiculos/coches?km=100000&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'moviles');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/electronica/moviles');
    expect(url.searchParams.has('km')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  // â”€â”€ El caso que YA era seguro (herencia): no debe perder nada â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('padre â†’ hija: el atributo heredado SÃ se conserva', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos?km=100000');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('km')).toBe('100000');
    await esperarPaginaSana(page);
  });

  test('hija â†’ padre: un atributo de la hija sigue valiendo en el padre', { tag: '@2b' }, async ({ page }) => {
    // Navegar el padre mezcla los anuncios de las hijas (categoryPath), asÃ­ que un
    // atributo de hija es filtro legÃ­timo ahÃ­.
    await page.goto('/vehiculos/coches?brand=Seat');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'vehiculos');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos');
    expect(url.searchParams.get('brand')).toBe('Seat');
    await esperarPaginaSana(page);
  });

  // â”€â”€ A4 â€” los rangos viajan como su atributo base â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('A4: el rango sobrevive al cambiar a una categorÃ­a donde su atributo vale', { tag: '@2b' }, async ({ page }) => {
    // `km` es de vehÃ­culos y lo heredan sus hijas, asÃ­ que vale en las dos puntas de
    // este salto. (El seed de test solo tiene vehiculosâ†’coches, asÃ­ que el trÃ¡nsito
    // que lo ejerce con datos reales es hijaâ†’padre.)
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

  // â”€â”€ TrÃ¡nsito inverso â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('categorÃ­a â†’ "Todas las categorÃ­as": vuelve a /busqueda conservando los filtros', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, '');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/busqueda');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    await esperarPaginaSana(page);
  });

  test('el selector marca la categorÃ­a en la que estÃ¡s', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    await expect(page.getByLabel(CATEGORIA)).toHaveValue('coches');

    await page.goto('/busqueda');
    await expect(page.getByLabel(CATEGORIA)).toHaveValue('');
  });

  test('el selector ofrece TODO el Ã¡rbol desde la ruta de categorÃ­a (antes solo bajaba un nivel)', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    const select = page.getByLabel(CATEGORIA);

    await expect(select.locator('option', { hasText: 'Todas las categorÃ­as' })).toHaveCount(1);
    // Otra rama del Ã¡rbol: inalcanzable con el viejo selector de "SubcategorÃ­a".
    await expect(select.locator('option', { hasText: 'MÃ³viles' })).toHaveCount(1);
    // Y el viejo control ya no existe.
    await expect(page.getByText('SubcategorÃ­a')).toHaveCount(0);
  });

  test('`page` se descarta al cambiar de categorÃ­a', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/busqueda?page=3&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  });

  // â”€â”€ P3: /busqueda?category= redirige â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('/busqueda?category=X redirige permanentemente a la ruta canÃ³nica', async ({ request }) => {
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

  test('/busqueda sin category sigue siendo la bÃºsqueda global, sin redirect', async ({ request }) => {
    expect((await request.get('/busqueda?q=golf', { maxRedirects: 0 })).status()).toBe(200);
  });

  // â”€â”€ `q` formalizado en la ruta de categorÃ­a â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test('q se ve en el <h1> de la categorÃ­a (antes filtraba en silencio)', async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('resultados para "golf"');
  });

  test('q llega al <title>', async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await expect(page).toHaveTitle(/golf/);
  });

  test('"Limpiar filtros" CONSERVA q â€” antes lo borraba', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await page.getByRole('button', { name: 'Limpiar filtros' }).first().click();
    // Se espera a la URL concreta, no a `networkidle`: el push del router puede
    // no haber aterrizado cuando la red se calma, y leer page.url() entonces
    // devuelve la de antes (visto: `province` seguÃ­a puesto en ~1 de cada 10).
    await page.waitForURL((url) => !url.searchParams.has('province'), { waitUntil: 'commit' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.has('province')).toBe(false);
  });

  test('q sobrevive al cambiar de categorÃ­a', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'moviles');

    expect(new URL(page.url()).searchParams.get('q')).toBe('golf');
  });
});

// â”€â”€ `condition` al saltar a una categorÃ­a solo-servicio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Necesita una categorÃ­a SERVICE_ONLY, que el seed no trae: se crea por la API de
// admin (mismo patrÃ³n que producto-servicio-flujo.spec.ts) y se borra al terminar,
// para no dejar mÃ¡s residuo en la base compartida del que ya arrastra.
test.describe('A2 â€” condition no viaja a una categorÃ­a de servicios', () => {
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
      throw new Error(`[A2 setup] no se pudo crear la categorÃ­a: ${res.status()} ${await res.text()}`);
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

  test('al elegir una categorÃ­a SERVICE_ONLY, `condition` se descarta y el resto se conserva', { tag: '@2b' }, async ({ page }) => {
    // Un servicio no tiene estado de conservaciÃ³n: arrastrar `condition` dejarÃ­a un
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

  test('hacia una categorÃ­a que admite productos, `condition` SÃ se conserva (el contraste)', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/electronica/moviles?condition=NEW');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'coches');

    expect(new URL(page.url()).searchParams.get('condition')).toBe('NEW');
  });
});
