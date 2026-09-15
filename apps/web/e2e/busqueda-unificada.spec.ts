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
import { adminApiToken, authedPost } from './helpers/api';
import { elegirEnDialogo, elegirProvincia } from './helpers/buscador';

const CATEGORIA = 'Categoría';

/**
 * Elige una categoría en el selector y espera a que la navegación aterrice.
 *
 * ⚠ BUSCADOR · BQ-E — EL GESTO CAMBIÓ, LO QUE SE PRUEBA NO. Donde había un
 * `selectOption(slug)` hay ahora los tres gestos del diálogo filtrable (abrir, filtrar,
 * elegir), que es el MISMO molde que el buscador de la portada estrenó en BQ-B y el mismo
 * helper. Dos consecuencias para quien lea los casos de abajo:
 *
 *  · se elige por el NOMBRE VISIBLE y no por el slug —un diálogo no tiene `value`—, así
 *    que «Coches» donde antes decía `coches`;
 *  · y «Todas las categorías» donde antes decía `''`, que además se lee mejor.
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
async function elegirCategoria(page: Page, nombre: string) {
  const origen = new URL(page.url()).pathname;
  await elegirEnDialogo(page, CATEGORIA, nombre);
  await page.waitForURL((url) => url.pathname !== origen, { waitUntil: 'commit' });
  await page.waitForLoadState('networkidle');
}

/** La categoría que el disparador declara ahora mismo, o `''` si no hay ninguna. */
async function categoriaMarcada(page: Page): Promise<string> {
  const etiqueta = await page.getByLabel(CATEGORIA, { exact: false }).first().getAttribute('aria-label');
  return etiqueta === CATEGORIA ? '' : (etiqueta ?? '').replace(`${CATEGORIA}: `, '');
}

/** La página ha renderizado resultados de verdad (ni error ni 400). */
async function esperarPaginaSana(page: Page) {
  await expect(page.getByRole('heading', { name: 'Algo salió mal' })).toHaveCount(0);
  await expect(page.getByLabel('Filtros')).toBeVisible();
}

test.describe('A2 — unificación de búsqueda', () => {
  // ── LA TRAMPA ─────────────────────────────────────────────────────────────
  test('global → categoría: el atributo ajeno se CAE; sin 400 y la página renderiza', { tag: '@2b' }, async ({ page }) => {
    // `ram` es de móviles. En /busqueda vale (sin categoría, la unión global lo acepta);
    // en coches NO existe, así que arrastrarlo daría 400.
    await page.goto('/busqueda?q=golf&ram=8&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Coches');

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

    await elegirCategoria(page, 'Móviles');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/electronica/moviles');
    expect(url.searchParams.has('km')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  // ── El caso que YA era seguro (herencia): no debe perder nada ──────────────
  test('padre → hija: el atributo heredado SÍ se conserva', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos?km=100000');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Coches');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('km')).toBe('100000');
    await esperarPaginaSana(page);
  });

  test('hija → padre: un atributo de la hija sigue valiendo en el padre', { tag: '@2b' }, async ({ page }) => {
    // Navegar el padre mezcla los anuncios de las hijas (categoryPath), así que un
    // atributo de hija es filtro legítimo ahí.
    await page.goto('/vehiculos/coches?brand=Seat');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Vehículos');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos');
    expect(url.searchParams.get('brand')).toBe('Seat');
    await esperarPaginaSana(page);
  });

  // ── A4 — los rangos viajan como su atributo base ──────────────────────────
  test('A4: el rango sobrevive al cambiar a una categoría donde su atributo vale', { tag: '@2b' }, async ({ page }) => {
    // `km` es de vehículos y lo heredan sus hijas, así que vale en las dos puntas de
    // este salto. (El seed de test solo tiene vehiculos→coches, así que el tránsito
    // que lo ejerce con datos reales es hija→padre.)
    await page.goto('/vehiculos/coches?km_min=50000&km_max=150000');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Vehículos');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos');
    expect(url.searchParams.get('km_min')).toBe('50000');
    expect(url.searchParams.get('km_max')).toBe('150000');
    await esperarPaginaSana(page);
  });

  test('A4: el rango se CAE, sin 400, si su atributo no vale en el destino', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?km_min=50000&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Móviles');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/electronica/moviles');
    expect(url.searchParams.has('km_min')).toBe(false);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  // ── Tránsito inverso ──────────────────────────────────────────────────────
  test('categoría → "Todas las categorías": vuelve a /busqueda conservando los filtros', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches?q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Todas las categorías');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/busqueda');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    await esperarPaginaSana(page);
  });

  /**
   * BQ-E — dónde estás lo dice el DISPARADOR, no un `value`. Y lo dice en el nombre
   * accesible además de en el texto: un `aria-label` pisa el contenido del botón, así que
   * sin eso un lector de pantalla anunciaría «Categoría» y nunca «Coches» — que es justo
   * lo que el `<select>` sí decía.
   */
  test('el selector marca la categoría en la que estás', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    expect(await categoriaMarcada(page)).toBe('Coches');

    await page.goto('/busqueda');
    expect(await categoriaMarcada(page)).toBe('');
  });

  test('el selector ofrece TODO el árbol desde la ruta de categoría (antes solo bajaba un nivel)', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    await page.getByLabel(CATEGORIA, { exact: false }).first().click();
    const dialogo = page.getByRole('dialog');

    await expect(dialogo.getByRole('option', { name: 'Todas las categorías' })).toHaveCount(1);
    // Otra rama del árbol: inalcanzable con el viejo selector de "Subcategoría".
    await expect(dialogo.getByRole('option', { name: 'Móviles', exact: false })).toHaveCount(1);
    // Y el viejo control ya no existe.
    await expect(page.getByText('Subcategoría')).toHaveCount(0);
  });

  /**
   * BQ-E — LO QUE EL DIÁLOGO TRAE Y EL `<select>` NO PODÍA: filtrar la lista.
   *
   * Con un árbol real, el `<select>` obligaba a recorrer a ojo una `<option>` por
   * categoría con su ruta entera dentro. Aquí se teclean tres letras. Y el filtro busca en
   * el NOMBRE, no en la ruta, que es lo que evita que «veh» devuelva la rama entera de
   * Vehículos (§3.3 del diseño).
   *
   * No se cuenta el total de filas a propósito: la base de esta batería es compartida y
   * otras specs crean categorías. Lo que se afirma es que la lista SE RECORTA —queda la
   * buscada y se va una que estaba—, que es la propiedad, no el número.
   */
  test('el diálogo filtra por el nombre, no por la ruta', async ({ page }) => {
    await page.goto('/busqueda');
    await page.getByLabel(CATEGORIA, { exact: false }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('option', { name: 'Móviles', exact: false })).toHaveCount(1);

    await dialogo.getByRole('combobox').fill('coch');

    await expect(dialogo.getByRole('option', { name: 'Coches', exact: false })).toHaveCount(1);
    await expect(dialogo.getByRole('option', { name: 'Móviles', exact: false })).toHaveCount(0);
    // La fila de limpiar NO se va al teclear: es una acción, no un resultado (decisión B).
    await expect(dialogo.getByRole('option', { name: 'Todas las categorías' })).toHaveCount(1);
  });

  test('`page` se descarta al cambiar de categoría', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/busqueda?page=3&q=golf');
    await esperarPaginaSana(page);

    await elegirCategoria(page, 'Coches');

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

    await elegirCategoria(page, 'Móviles');

    expect(new URL(page.url()).searchParams.get('q')).toBe('golf');
  });
});

/**
 * ══ BUSCADOR · BQ-E — EL OTRO DIÁLOGO DEL PANEL: LA PROVINCIA ════════════════════════
 *
 * El `<select>` de provincia de `FilterPanel` era el segundo control de provincia del
 * sitio y el §12.4 del diseño lo dejó anotado como «el mismo `<select>` y el mismo
 * problema». Ahora es el MISMO `ProvinciaDialogo` que monta la portada, con el mismo
 * helper de test — lo único distinto es que aquí elegir navega.
 *
 * ── SE ELIGE UNA GRAFÍA COOFICIAL A PROPÓSITO ──────────────────────────────────────
 *
 * `Alicante/Alacant` es la entrada literal de `lib/provincias.ts`, barra incluida, y es
 * el string contra el que el backend filtra con un `=` EXACTO (`search.service.ts`). Si
 * algún día alguien dejara que el texto TECLEADO llegara a la URL —el defecto que el
 * molde hace imposible por construcción—, este caso sería el primero en caer: nadie
 * teclea la barra.
 */
test.describe('BQ-E — la provincia del panel', () => {
  const PROVINCIA = 'Alicante/Alacant';

  test('elegir una provincia NAVEGA, con el valor exacto y sin perder la consulta', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/busqueda?q=golf');
    await esperarPaginaSana(page);

    await elegirProvincia(page, PROVINCIA);
    await page.waitForURL((url) => url.searchParams.has('province'), { waitUntil: 'commit' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/busqueda');
    expect(url.searchParams.get('province')).toBe(PROVINCIA);
    expect(url.searchParams.get('q')).toBe('golf');
    await esperarPaginaSana(page);
  });

  test('«Toda España» retira el filtro', { tag: '@2b' }, async ({ page }) => {
    await page.goto(`/busqueda?q=golf&province=${encodeURIComponent(PROVINCIA)}`);
    await esperarPaginaSana(page);
    // La provincia activa se lee en el disparador, como la categoría.
    await expect(page.getByLabel('Provincia', { exact: false }).first()).toHaveText(PROVINCIA);

    await elegirProvincia(page, 'Toda España');
    await page.waitForURL((url) => !url.searchParams.has('province'), { waitUntil: 'commit' });

    expect(new URL(page.url()).searchParams.get('q')).toBe('golf');
  });

  /** Y el mismo control, con el mismo molde, en la otra ruta que monta el panel. */
  test('en /[categoria] hace lo mismo, sin salirse de la categoría', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/vehiculos/coches');
    await esperarPaginaSana(page);

    await elegirProvincia(page, 'Madrid');
    await page.waitForURL((url) => url.searchParams.has('province'), { waitUntil: 'commit' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('province')).toBe('Madrid');
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

  /** BQ-E — el diálogo se elige por el NOMBRE visible, así que éste deja de ser decorativo. */
  const SVC_NOMBRE = 'A2 Solo Servicios';

  test.beforeAll(async ({ request }) => {
    adminToken = adminApiToken();
    svcSlug = `a2-svc-${Date.now()}`;
    const res = await authedPost(request, '/admin/categories', adminToken, {
      name: SVC_NOMBRE,
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

  test('al elegir una categoría SERVICE_ONLY, `condition` se descarta y el resto se conserva', { tag: '@2b' }, async ({ page }) => {
    // Un servicio no tiene estado de conservación: arrastrar `condition` dejaría un
    // filtro activo, invisible (el panel lo oculta en contexto de servicio) y
    // restrictivo.
    await page.goto('/vehiculos/coches?condition=NEW&q=golf&province=Madrid');
    await esperarPaginaSana(page);

    await elegirCategoria(page, SVC_NOMBRE);

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

    await elegirCategoria(page, 'Coches');

    expect(new URL(page.url()).searchParams.get('condition')).toBe('NEW');
  });
});
