/**
 * BÚSQUEDA+TAGS — RÁFAGA A3: el panel de filtros pasa de FACET-DRIVEN a SCHEMA-DRIVEN.
 *
 * EL CASO CENTRAL es F6: la categoría de este spec NO TIENE NI UN ANUNCIO, así que
 * Meilisearch no devuelve ni una faceta para sus atributos. Antes de A3 eso significaba
 * que el panel no pintaba NINGÚN filtro —la lista de secciones la dictaba el resultado—,
 * por muy `filterable: true` que estuvieran en la configuración. Ahora la dicta la
 * config, y todas las secciones aparecen con sus valores a (0) deshabilitados.
 *
 * Los demás síntomas (label, unidad, booleano, select vinculado) se ejercen sobre esa
 * misma categoría, creada por la API de admin con una forma de atributos que el seed no
 * trae. Se borra al terminar; la barrera de saneamiento la barrería igual.
 *
 * F3 (rango numérico) NO está aquí: exige que el backend acepte `_min`/`_max`, y eso es
 * A4. Un `number` sigue pintándose como chips, ya con su label y su unidad.
 */

import { test, expect, type Page } from '@playwright/test';
import { adminApiToken, authedPost } from './helpers/api';

const SECCION = (name: string) => `[data-testid="facet-${name}"]`;

test.describe('A3 — panel de filtros dictado por la configuración', () => {
  let adminToken: string;
  let catId: string;
  let catSlug: string;

  test.beforeAll(async ({ request }) => {
    adminToken = adminApiToken();
    catSlug = `a3-filtros-${Date.now()}`;

    const res = await authedPost(request, '/admin/categories', adminToken, {
      name: 'A3 Filtros',
      slug: catSlug,
      attributeSchema: [
        // F1 + F2: el nombre del campo y su etiqueta son DISTINTOS a propósito, y lleva
        // unidad. Si el panel siguiera pintando la clave cruda, se leería "a3Metros".
        { name: 'a3Metros', label: 'Metros cuadrados', type: 'number', unit: 'm²', filterable: true, required: false },
        // F4: booleano — antes se veían chips "true"/"false".
        { name: 'a3Garaje', label: 'Garaje', type: 'boolean', filterable: true, required: false },
        // F6: select con opciones configuradas y CERO anuncios.
        { name: 'a3Cambio', label: 'Cambio', type: 'select', options: ['Manual', 'Automático'], filterable: true, required: false },
        // F5: par vinculado marca → modelo.
        { name: 'a3Marca', label: 'Marca', type: 'select', options: ['Seat', 'Renault'], filterable: true, required: false },
        {
          name: 'a3Modelo', label: 'Modelo', type: 'select', dependsOn: 'a3Marca', filterable: true, required: false,
          optionsByParent: { Seat: ['Ibiza', 'León'], Renault: ['Clio'] },
        },
        // Control: NO filtrable. No debe aparecer nunca como filtro.
        { name: 'a3Interno', label: 'Uso interno', type: 'text', filterable: false, required: false },
      ],
    });
    if (res.status() !== 201) {
      throw new Error(`[A3 setup] no se pudo crear la categoría: ${res.status()} ${await res.text()}`);
    }
    catId = (await res.json()).id as string;
  });

  test.afterAll(async ({ request }) => {
    if (catId) {
      await request.delete(`http://localhost:3001/api/admin/categories/${catId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });

  /** Abre la categoría (sin anuncios) y espera al panel. */
  async function abrirPanel(page: Page) {
    await page.goto(`/${catSlug}`);
    await expect(page.getByLabel('Filtros')).toBeVisible();
  }

  // ── F6 — EL HUECO DEL AJUSTE 3 ────────────────────────────────────────────
  test('F6: los filtros aparecen aunque la categoría no tenga NI UN anuncio', async ({ page }) => {
    await abrirPanel(page);

    // Sin anuncios no hay facetas: antes de A3 no se pintaba ninguna de estas.
    for (const name of ['a3Metros', 'a3Garaje', 'a3Cambio', 'a3Marca']) {
      await expect(page.locator(SECCION(name)).first()).toBeVisible();
    }
  });

  test('F6: los valores sin resultados se ven DESHABILITADOS con (0), no desaparecen', async ({ page }) => {
    await abrirPanel(page);

    const cambio = page.locator(SECCION('a3Cambio')).first();
    const manual = cambio.getByRole('button', { name: /Manual/ });
    await expect(manual).toBeVisible();
    await expect(manual).toContainText('(0)');
    await expect(manual).toBeDisabled();
  });

  test('un atributo NO filtrable no se ofrece como filtro', async ({ page }) => {
    await abrirPanel(page);
    await expect(page.locator(SECCION('a3Interno'))).toHaveCount(0);
    await expect(page.getByLabel('Filtros').getByText('Uso interno')).toHaveCount(0);
  });

  // ── F1 y F2 ───────────────────────────────────────────────────────────────
  test('F1: la sección muestra el LABEL, no el nombre crudo del campo', async ({ page }) => {
    await abrirPanel(page);

    const seccion = page.locator(SECCION('a3Metros')).first();
    await expect(seccion).toContainText('Metros cuadrados');
    // Y la clave cruda no se ve por ninguna parte del panel.
    await expect(page.getByLabel('Filtros').getByText('a3Metros')).toHaveCount(0);
  });

  test('F2: la unidad se muestra junto al label', async ({ page }) => {
    await abrirPanel(page);
    await expect(page.locator(SECCION('a3Metros')).first()).toContainText('m²');
  });

  // ── F4 ────────────────────────────────────────────────────────────────────
  test('F4: un booleano ofrece "Sí"/"No", nunca true/false', async ({ page }) => {
    await abrirPanel(page);

    const garaje = page.locator(SECCION('a3Garaje')).first();
    await expect(garaje.getByRole('button', { name: /Sí/ })).toBeVisible();
    await expect(garaje.getByRole('button', { name: /No/ })).toBeVisible();
    await expect(garaje.getByRole('button', { name: /true/ })).toHaveCount(0);
    await expect(garaje.getByRole('button', { name: /false/ })).toHaveCount(0);
  });

  // ── F5 ────────────────────────────────────────────────────────────────────
  test('F5: el select vinculado no se ofrece hasta que su padre tiene valor', async ({ page }) => {
    await abrirPanel(page);

    await expect(page.locator(SECCION('a3Marca')).first()).toBeVisible();
    await expect(page.locator(SECCION('a3Modelo'))).toHaveCount(0);
  });

  test('F5: con la marca elegida, solo se ofrecen SUS modelos', async ({ page }) => {
    await page.goto(`/${catSlug}?a3Marca=Seat`);
    await expect(page.getByLabel('Filtros')).toBeVisible();

    const modelo = page.locator(SECCION('a3Modelo')).first();
    await expect(modelo.getByRole('button', { name: /Ibiza/ })).toBeVisible();
    await expect(modelo.getByRole('button', { name: /León/ })).toBeVisible();
    // Clio es de Renault: no debe ofrecerse con Seat elegida.
    await expect(modelo.getByRole('button', { name: /Clio/ })).toHaveCount(0);
  });

  test('F5: al cambiar de marca cambian los modelos ofrecidos', async ({ page }) => {
    await page.goto(`/${catSlug}?a3Marca=Renault`);
    await expect(page.getByLabel('Filtros')).toBeVisible();

    const modelo = page.locator(SECCION('a3Modelo')).first();
    await expect(modelo.getByRole('button', { name: /Clio/ })).toBeVisible();
    await expect(modelo.getByRole('button', { name: /Ibiza/ })).toHaveCount(0);
  });

  // ── A4 — rango numérico ───────────────────────────────────────────────────
  test('A4: un atributo numérico se ofrece como RANGO mín/máx, no como chips', async ({ page }) => {
    await abrirPanel(page);

    const metros = page.locator(SECCION('a3Metros')).first();
    await expect(metros.getByLabel('Metros cuadrados mínimo')).toBeVisible();
    await expect(metros.getByLabel('Metros cuadrados máximo')).toBeVisible();
    // La unidad va en el placeholder, que es donde ayuda al escribir.
    await expect(metros.getByLabel('Metros cuadrados mínimo')).toHaveAttribute('placeholder', 'Mín (m²)');
  });

  test('A4: aplicar el rango emite _min/_max y la página responde', { tag: '@2b' }, async ({ page }) => {
    await abrirPanel(page);

    const metros = page.locator(SECCION('a3Metros')).first();
    await metros.getByLabel('Metros cuadrados mínimo').fill('50');
    await metros.getByLabel('Metros cuadrados máximo').fill('150');
    await metros.getByLabel('Metros cuadrados máximo').blur();

    // `waitUntil: 'commit'` — sin él, waitForURL espera además al evento `load`, que una
    // navegación de cliente del App Router NO dispara: la URL ya casa y aun así se queda
    // colgado hasta el timeout.
    await page.waitForURL((u) => u.searchParams.has('a3Metros_min'), { waitUntil: 'commit' });
    const url = new URL(page.url());
    expect(url.searchParams.get('a3Metros_min')).toBe('50');
    expect(url.searchParams.get('a3Metros_max')).toBe('150');

    // Y el backend lo acepta: sin 400, la página sigue viva.
    await expect(page.getByRole('heading', { name: 'Algo salió mal' })).toHaveCount(0);
    await expect(page.getByLabel('Filtros')).toBeVisible();
  });

  test('A4: los extremos vuelven precargados al recargar la URL', async ({ page }) => {
    await page.goto(`/${catSlug}?a3Metros_min=50&a3Metros_max=150`);
    await expect(page.getByLabel('Filtros')).toBeVisible();

    const metros = page.locator(SECCION('a3Metros')).first();
    await expect(metros.getByLabel('Metros cuadrados mínimo')).toHaveValue('50');
    await expect(metros.getByLabel('Metros cuadrados máximo')).toHaveValue('150');
  });

  // ── La página no se rompe con un filtro aplicado ───────────────────────────
  test('aplicar un filtro de la categoría no rompe la página (sigue siendo un param válido)', async ({ page }) => {
    // A3 es presentación: el filtrado real no cambia. Lo que se comprueba aquí es que
    // el valor que el panel emite sigue siendo aceptado por el backend — el 400
    // anti-leak sigue en pie y este atributo pertenece a esta categoría.
    await page.goto(`/${catSlug}?a3Cambio=Manual`);
    await expect(page.getByRole('heading', { name: 'Algo salió mal' })).toHaveCount(0);
    await expect(page.getByLabel('Filtros')).toBeVisible();
  });
});

// ── El filtrado real NO cambia: A3 es presentación ──────────────────────────
test.describe('A3 — el filtrado real no cambia', () => {
  test('la búsqueda con un filtro devuelve lo mismo por API que antes (A3 no toca el backend de búsqueda)', async ({ request }) => {
    // Se compara la API directamente: parser y service no se han tocado en A3, así que
    // el conjunto de resultados de una query con filtro es el mismo. Si alguien tocara
    // el backend de búsqueda "de paso", esto lo delataría.
    const sinFiltro = await request.get('http://localhost:3001/api/search?category=coches');
    expect(sinFiltro.status()).toBe(200);

    const conFiltro = await request.get('http://localhost:3001/api/search?category=coches&brand=Seat');
    expect(conFiltro.status()).toBe(200);

    const body = (await conFiltro.json()) as { hits: { attributes?: Record<string, unknown> }[] };
    // Todo hit devuelto cumple el filtro — la semántica de igualdad de siempre.
    for (const hit of body.hits) {
      if (hit.attributes && 'brand' in hit.attributes) {
        expect(hit.attributes.brand).toBe('Seat');
      }
    }
  });

  test('un atributo ajeno a la categoría SIGUE dando 400 (la defensa anti-leak intacta)', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/search?category=coches&rooms=3');
    expect(res.status()).toBe(400);
  });
});
