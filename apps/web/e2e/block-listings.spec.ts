// SISTEMA DE BLOQUES — Ráfaga 3, bloque `listings` (primer bloque dinámico):
// verifica contra datos REALES (Postgres + Meilisearch, no mocks) que (a) el
// bloque pinta los anuncios reales de una categoría — la MISMA fuente que
// /busqueda, vía SearchService.search() — y (b) una categoría sin anuncios
// oculta el bloque por completo, incluido su propio título, sin dejar un
// hueco visible en la página.
//
// Ambas categorías (poblada y vacía) se crean al vuelo, en vez de reutilizar
// "electronica": la suite Playwright no trunca la BD entre specs, así que
// "electronica" acumula anuncios de otras specs con el tiempo — algunos
// posiblemente destacados (boostScore:desc es SIEMPRE la primera rankingRule
// de Meilisearch, por delante de cualquier `sort`), lo que podría empujar
// nuestro anuncio fuera de `hitsPerPage` y hacer el test flaky. Una
// categoría recién creada garantiza que nuestro anuncio es el único
// candidato posible.
//
// El TTL corto (180s) del bloque dinámico está cubierto a nivel unitario en
// resolve-listings.test.ts (mapeo de opciones a search()) — esperar 180s
// reales en un test e2e sería lento y frágil sin aportar nada que el test
// unitario no cubra ya sobre el mecanismo.

import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost, pollSearch } from './helpers/api';

test.describe('Bloque listings (dinámico) — datos reales', () => {
  test('pinta anuncios reales de una categoría con contenido y oculta la categoría vacía', async ({
    adminContext,
    request,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const adminToken = adminApiToken();

    // ── Categoría con contenido: propia, creada al vuelo ─────────────────────
    const populatedSlug = `r3-poblada-${ts}`;
    const populatedName = `R3 Poblada ${ts}`;
    const populatedCatRes = await authedPost(request, '/admin/categories', adminToken, {
      name: populatedName,
      slug: populatedSlug,
    });
    expect(populatedCatRes.status()).toBe(201);
    const { id: populatedCategoryId } = await populatedCatRes.json();

    const listingTitle = `R3 Bloque listings ${ts}`;
    const createRes = await authedPost(request, '/listings', adminToken, {
      title: listingTitle,
      description: 'Anuncio real para probar el bloque dinámico listings.',
      price: 50,
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      categoryId: populatedCategoryId,
      attributes: {},
      city: 'Madrid',
      province: 'Madrid',
    });
    expect(createRes.status()).toBe(201);
    const { id: listingId } = await createRes.json();

    const publishRes = await authedPost(request, `/listings/${listingId}/publish`, adminToken, {});
    expect(publishRes.status()).toBe(200);

    // Indexado en Meilisearch es async (BullMQ) — sondear hasta que search()
    // (la MISMA fuente que usará el bloque) lo devuelva.
    await pollSearch(request, { category: populatedSlug }, (body) => body.totalHits >= 1);

    // ── Categoría garantizada vacía: recién creada, sin anuncios nunca ───────
    const emptySlug = `r3-vacia-${ts}`;
    const emptyName = `R3 Vacía ${ts}`;
    const emptyCatRes = await authedPost(request, '/admin/categories', adminToken, {
      name: emptyName,
      slug: emptySlug,
    });
    expect(emptyCatRes.status()).toBe(201);

    // ── Construir la página con dos bloques `listings` ──────────────────────
    const page = await adminContext.newPage();
    const title = `Página con bloque listings ${ts}`;
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    async function addListingsBlock(sectionTitle: string, categorySlug: string, categoryName: string) {
      await page.getByRole('button', { name: 'Añadir bloque' }).click();
      await page
        .getByTestId('block-type-picker')
        .getByText('Anuncios de una categoría', { exact: true })
        .click();
      const rows = page.getByTestId('block-row-listings');
      const row = rows.last();
      await row.getByPlaceholder('p.ej. Lo más reciente en Móviles').fill(sectionTitle);
      const select = row.getByTestId('listings-category-select');
      await expect(select.locator('option', { hasText: new RegExp(`^${categoryName}$`) })).toHaveCount(1);
      await select.selectOption(categorySlug);
    }

    await addListingsBlock('Sección poblada', populatedSlug, populatedName);
    await addListingsBlock('Sección vacía', emptySlug, emptyName);

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    // Sección poblada: título + anuncio real visibles.
    await expect(popup.getByText('Sección poblada')).toBeVisible();
    await expect(popup.getByText(listingTitle)).toBeVisible();

    // Sección vacía: el bloque entero se oculta, incluido su propio título —
    // no debe quedar un hueco visible en la página.
    await expect(popup.getByText('Sección vacía')).toHaveCount(0);

    await popup.close();
  });
});
