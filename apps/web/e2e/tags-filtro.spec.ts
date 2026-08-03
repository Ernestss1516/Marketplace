// BÚSQUEDA+TAGS B3 — la sección "Etiquetas" del panel de filtros.
//
// Lo que solo se puede probar aquí: que marcar una SEGUNDA etiqueta ACUMULA en vez de
// sustituir a la primera. Es la única sección multi-selección del panel — el resto de
// facetas son toggles excluyentes (`toggleFacet`) — y esa diferencia vive en el
// navegador, no en el backend.
//
// El AND en sí, el descarte de slugs viejos y la supervivencia al cambio de categoría se
// prueban donde son deterministas: `tags-b3.e2e-spec.ts` (backend) y
// `src/lib/tags-filter.test.ts` (unitario). Aquí solo la interacción.
//
// El seed de test (B1) da a `coches`: unico-dueno (propio) + garantia y envio-incluido
// (heredados de vehiculos). Los anuncios los crea este spec, porque el seed de Playwright
// publica sin etiquetas.

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, pollSearch } from './helpers/api';
import { limpiarAnunciosPorPrefijo } from './helpers/seed-listings';
import { clicarYEsperarUrl } from './helpers/nav';
import type { APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const COCHES = '/vehiculos/coches';

async function publicarConTags(
  request: APIRequestContext,
  token: string,
  titulo: string,
  tags: string[],
): Promise<{ id: string; slug: string }> {
  const cat = await (await request.get(`${API_BASE}/api/categories/coches`)).json();
  const res = await authedPost(request, '/listings', token, {
    title: titulo,
    description: `Anuncio de prueba para el filtro por etiquetas: ${titulo}.`,
    price: 12345,
    type: 'PRODUCT',
    condition: 'GOOD',
    priceType: 'FIXED',
    categoryId: cat.id,
    // `coches` tiene atributos obligatorios en el seed (year, km). No son el objeto de
    // este spec, pero sin ellos el alta da 422 antes de llegar a las etiquetas.
    attributes: { year: 2018, km: 90000 },
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
    tags,
  });
  if (!res.ok()) throw new Error(`[publicarConTags] ${res.status()} ${await res.text()}`);
  const creado = await res.json();
  const pub = await authedPost(request, `/listings/${creado.id}/publish`, token, {});
  if (!pub.ok()) throw new Error(`[publicarConTags] publish ${pub.status()} ${await pub.text()}`);
  return { id: creado.id, slug: creado.slug };
}

/** Un chip de la sección Etiquetas, por su texto visible. */
function chipEtiqueta(page: import('@playwright/test').Page, nombre: string) {
  return page.getByTestId('filter-tags').getByRole('button', { name: new RegExp(nombre) });
}

test.describe('B3 — sección Etiquetas del panel', () => {
  let unicoDuenoId = '';

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const token = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');

    // BARRERA (ver e2e/helpers/seed-listings.ts): Playwright descarta el worker
    // cuando un test falla —también con `--retries=0`— y arranca otro, lo que
    // vuelve a ejecutar este `beforeAll`. Sin esto, cada fallo dejaba OTRA
    // generación de los tres anuncios y la página acababa mostrando varias a la
    // vez ("resolved to 3 elements", con tres sellos distintos). Borrar lo que
    // haya quedado de generaciones anteriores deja el terreno igual que en la
    // primera ejecución, sea o no la primera.
    await limpiarAnunciosPorPrefijo(request, token, 'B3 ');

    const sello = Date.now();
    const a = await publicarConTags(request, token, `B3 Solo unico dueno ${sello}`, ['unico-dueno']);
    unicoDuenoId = a.id;
    await publicarConTags(request, token, `B3 Con garantia y dueno ${sello}`, [
      'unico-dueno', 'garantia',
    ]);
    await publicarConTags(request, token, `B3 Solo garantia ${sello}`, ['garantia']);

    // Esperar a que los tres estén indexados antes de mirar la UI.
    await pollSearch(
      request,
      { category: 'coches', tags: 'unico-dueno' },
      // `hits` llega como unknown[] desde el helper: se estrecha aquí en vez de
      // anotar el callback, que es lo que TypeScript no acepta.
      (body) => body.hits.some((h) => (h as { id: string }).id === unicoDuenoId),
    );
    await request.dispose();
  });

  test('la sección aparece con los tags de la categoría y sus conteos', async ({ page }) => {
    await page.goto(COCHES);
    await page.waitForLoadState('networkidle');

    const seccion = page.getByTestId('filter-tags');
    await expect(seccion).toBeVisible();
    // El propio de coches y los heredados de vehiculos, todos ofrecidos.
    await expect(chipEtiqueta(page, 'Único dueño')).toBeVisible();
    await expect(chipEtiqueta(page, 'Con garantía')).toBeVisible();
    await expect(chipEtiqueta(page, 'Envío incluido')).toBeVisible();
  });

  test('MULTI-SELECCIÓN: marcar la segunda NO deselecciona la primera', async ({ page }) => {
    // El corazón de este spec. Con una faceta normal (toggleFacet) el segundo clic
    // sustituiría al primero; aquí tienen que acumular.
    await page.goto(COCHES);
    await page.waitForLoadState('networkidle');

    await clicarYEsperarUrl(page, chipEtiqueta(page, 'Único dueño'), (url) => url.searchParams.get('tags') === 'unico-dueno');

    await clicarYEsperarUrl(page, chipEtiqueta(page, 'Con garantía'), (url) => {
      const t = (url.searchParams.get('tags') ?? '').split(',');
      return t.includes('unico-dueno') && t.includes('garantia');
    });

    // Y en CSV, no repitiendo la clave.
    const url = new URL(page.url());
    expect(url.searchParams.getAll('tags')).toHaveLength(1);

    // El aviso de que el filtro es AND aparece con dos o más.
    await expect(page.getByText(/TODAS las etiquetas marcadas/i)).toBeVisible();
  });

  test('desmarcar quita solo esa etiqueta, y la última limpia el parámetro', async ({ page }) => {
    await page.goto(`${COCHES}?tags=unico-dueno,garantia`);
    await page.waitForLoadState('networkidle');

    await clicarYEsperarUrl(page, chipEtiqueta(page, 'Con garantía'), (url) => url.searchParams.get('tags') === 'unico-dueno');

    await clicarYEsperarUrl(page, chipEtiqueta(page, 'Único dueño'), (url) => !url.searchParams.has('tags'));
  });

  test('el filtro se refleja en los resultados', async ({ page }) => {
    await page.goto(`${COCHES}?tags=unico-dueno,garantia`);
    await page.waitForLoadState('networkidle');

    // Solo el que tiene AMBAS.
    await expect(page.getByText(/B3 Con garantia y dueno/)).toBeVisible();
    await expect(page.getByText(/B3 Solo garantia/)).toHaveCount(0);
  });

  test('un chip de la FICHA lleva a la búsqueda filtrada por esa etiqueta', async ({
    page, request,
  }) => {
    const detalle = await (await request.get(`${API_BASE}/api/listings/${unicoDuenoId}`)).json()
      .catch(() => null);
    // La ficha pública se busca por slug, no por id.
    const slug = detalle?.slug
      ?? (await (await request.get(`${API_BASE}/api/search?category=coches&tags=unico-dueno`)).json())
        .hits.find((h: { id: string }) => h.id === unicoDuenoId)?.slug;

    await page.goto(`/anuncio/${slug}`);
    await page.waitForLoadState('networkidle');

    const chip = page.getByTestId('ficha-tags').getByRole('link', { name: 'Único dueño' });
    await expect(chip).toBeVisible();

    await clicarYEsperarUrl(
      page,
      chip,
      (url) => url.pathname === COCHES && url.searchParams.get('tags') === 'unico-dueno',
    );
  });
});
