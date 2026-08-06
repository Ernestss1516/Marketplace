// SISTEMA DE BLOQUES — prueba de fuego: un admin (simulado) construye una
// página completa con los 13 tipos de bloque (9 de Ráfaga 2 + 4 de Ráfaga 3)
// desde /admin/paginas/nueva, la publica, y se verifica que /paginas/[slug]
// la renderiza con el MISMO BlockRenderer que usa el preview del editor —
// "lo que ve el admin es lo que se publica".
//
// El bloque `listings` (primer bloque dinámico) necesita un anuncio REAL
// indexado en Meilisearch para poder verificar que pinta datos reales — se
// crea vía API antes de construir la página (mismo helper que el resto de la
// suite e2e), en una categoría PROPIA creada al vuelo (no "electronica"): la
// suite Playwright no trunca la BD entre specs (a diferencia de la batería
// Jest e2e), así que "electronica" acumula anuncios de otras specs a lo
// largo del tiempo — algunos posiblemente destacados (boostScore:desc es
// SIEMPRE la primera rankingRule de Meilisearch, por delante de cualquier
// `sort`), lo que podría empujar nuestro anuncio recién creado fuera de
// `hitsPerPage` y hacer el test flaky. Una categoría recién creada garantiza
// que nuestro anuncio es el único candidato posible. Las verificaciones
// específicas de `listings` (categoría vacía oculta el bloque, TTL de
// caché) viven en block-listings.spec.ts — aquí solo se prueba que el tipo
// encaja sin romper el conjunto de los 13.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import * as path from 'path';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost, pollSearch } from './helpers/api';

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

async function addBlock(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByTestId('block-type-picker').getByText(label, { exact: true }).click();
}

test.describe('Editor de bloques — construir una página completa con los 13 tipos', () => {
  test('ADMIN añade los 13 bloques, guarda, publica, y el público los ve todos', async ({
    adminContext,
    request,
  }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();

    // ── Anuncio real para el bloque `listings` (primer bloque dinámico) ──────
    // Categoría propia (ver comentario de cabecera) — evita depender de lo
    // que otras specs hayan acumulado en "electronica".
    const adminToken = adminApiToken();
    const listingsCategorySlug = `r3-fuego-${suffix}`;
    const listingsCategoryName = `R3 Fuego ${suffix}`;
    const catRes = await authedPost(request, '/admin/categories', adminToken, {
      name: listingsCategoryName,
      slug: listingsCategorySlug,
    });
    expect(catRes.status()).toBe(201);
    const { id: listingsCategoryId } = await catRes.json();

    const listingTitle = `R3 Anuncio para bloque listings ${suffix}`;
    const createRes = await authedPost(request, '/listings', adminToken, {
      title: listingTitle,
      description: 'Anuncio real para el bloque listings en la prueba de fuego E2E.',
      price: 75,
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      categoryId: listingsCategoryId,
      attributes: {},
      city: 'Madrid',
      province: 'Madrid',
    });
    expect(createRes.status()).toBe(201);
    const { id: listingId } = await createRes.json();
    const publishRes = await authedPost(request, `/listings/${listingId}/publish`, adminToken, {});
    expect(publishRes.status()).toBe(200);
    await pollSearch(
      request,
      { category: listingsCategorySlug },
      (body) => body.totalHits >= 1,
    );

    const page = await adminContext.newPage();
    const title = `Página completa de bloques ${suffix}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    // 1. text
    await addBlock(page, 'Texto');
    const textRow = page.getByTestId('block-row-text');
    await textRow.locator('.w-md-editor-text-input').fill('# Encabezado E2E\n\nPárrafo con **negrita**.');

    // 2. image (upload real vía R2/MinIO — molde sponsored-ads)
    await addBlock(page, 'Imagen');
    const imageRow = page.getByTestId('block-row-image');
    await imageRow.getByTestId('block-image-input').setInputFiles(TEST_IMAGE);
    await expect(imageRow.getByAltText('Preview')).toBeVisible({ timeout: 15_000 });
    await imageRow.getByPlaceholder('Describe la imagen (accesibilidad y SEO)').fill('Imagen de prueba E2E');

    // 3. imageText (composición de imagen + texto — Ráfaga 3)
    await addBlock(page, 'Imagen y texto');
    const imageTextRow = page.getByTestId('block-row-imageText');
    await imageTextRow.getByTestId('block-image-input').setInputFiles(TEST_IMAGE);
    await expect(imageTextRow.getByAltText('Preview')).toBeVisible({ timeout: 15_000 });
    await imageTextRow.getByPlaceholder('Describe la imagen (accesibilidad y SEO)').fill('Imagen y texto E2E');
    await imageTextRow.locator('.w-md-editor-text-input').fill('Texto compuesto E2E.');

    // 4. cta
    await addBlock(page, 'Botón destacado');
    const ctaRow = page.getByTestId('block-row-cta');
    await ctaRow.getByPlaceholder('p.ej. Publicar anuncio').fill('Ir a publicar');
    await ctaRow.getByPlaceholder('/publicar o https://...').fill('/publicar');

    // 5. quote
    await addBlock(page, 'Cita');
    const quoteRow = page.getByTestId('block-row-quote');
    await quoteRow.getByPlaceholder('La frase que quieres destacar').fill('Una cita construida en E2E');
    await quoteRow.getByPlaceholder('Nombre de quien lo dijo').fill('Autor E2E');

    // 6. faq (ya trae 1 sub-ítem por defecto)
    await addBlock(page, 'Preguntas frecuentes');
    const faqRow = page.getByTestId('block-row-faq');
    await faqRow.getByPlaceholder('Pregunta', { exact: true }).fill('¿Pregunta E2E?');
    await faqRow.getByPlaceholder('Respuesta', { exact: true }).fill('Respuesta E2E.');

    // 7. hub (ya trae 1 sub-ítem por defecto)
    await addBlock(page, 'Enlaces relacionados');
    const hubRow = page.getByTestId('block-row-hub');
    await hubRow.getByPlaceholder('Texto del enlace').fill('Buscar anuncios');
    await hubRow.getByPlaceholder('/busqueda o https://...').fill('/busqueda');

    // 8. steps (reutiliza SubItemList — Ráfaga 3)
    await addBlock(page, 'Pasos');
    const stepsRow = page.getByTestId('block-row-steps');
    await stepsRow.getByPlaceholder('Título del paso').fill('Paso uno E2E');
    await stepsRow.getByPlaceholder('Descripción').fill('Descripción del paso uno E2E.');

    // 9. profile (reutiliza SubItemList — Ráfaga 3)
    await addBlock(page, 'Ficha');
    const profileRow = page.getByTestId('block-row-profile');
    await profileRow.getByPlaceholder('p.ej. Ana García').fill('Ana E2E');
    await profileRow.getByPlaceholder('Etiqueta (p.ej. Experiencia)').fill('Experiencia');
    await profileRow.getByPlaceholder('Valor (p.ej. 10 años)').fill('10 años');

    // 10. video
    await addBlock(page, 'Vídeo');
    const videoRow = page.getByTestId('block-row-video');
    await videoRow.getByPlaceholder(/youtube\.com/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(videoRow.locator('iframe')).toBeVisible();

    // 11. table — tocar también añadir fila/columna, la parte más cara del editor.
    await addBlock(page, 'Tabla');
    const tableRow = page.getByTestId('block-row-table');
    await tableRow.getByPlaceholder('Columna 1').fill('Cabecera E2E');
    await tableRow.getByRole('button', { name: 'Columna', exact: true }).click();
    await tableRow.getByRole('button', { name: 'Añadir fila' }).click();
    const cells = tableRow.locator('tbody input');
    await cells.nth(0).fill('celda-1-1');
    await cells.nth(1).fill('celda-1-2');

    // 12. listings (primer bloque DINÁMICO — Ráfaga 3, apunta a la categoría propia con el anuncio real creado arriba)
    await addBlock(page, 'Anuncios de una categoría');
    const listingsRow = page.getByTestId('block-row-listings');
    await listingsRow.getByPlaceholder('p.ej. Lo más reciente en Móviles').fill('Anuncios destacados E2E');
    const listingsCategorySelect = listingsRow.getByTestId('listings-category-select');
    await expect(
      listingsCategorySelect.locator('option', { hasText: new RegExp(`^${listingsCategoryName}$`) }),
    ).toHaveCount(1);
    await listingsCategorySelect.selectOption(listingsCategorySlug);

    // 13. separator
    await addBlock(page, 'Separador');
    await expect(page.getByTestId('block-row-separator')).toBeVisible();

    // Preview: el mismo BlockRenderer que el sitio público.
    await page.getByRole('button', { name: /ver preview/i }).click();
    await expect(page.getByText('Encabezado E2E')).toBeVisible();
    await expect(page.getByText('Una cita construida en E2E')).toBeVisible();
    await expect(page.getByText('Texto compuesto E2E.')).toBeVisible();
    await expect(page.getByText('Paso uno E2E', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /ocultar preview/i }).click();

    // Guardar + publicar.
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // --- Verificar en público: los 13 bloques presentes ---
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    await expect(popup.locator('h1', { hasText: title })).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'Encabezado E2E' })).toBeVisible(); // text
    await expect(popup.getByText('negrita')).toBeVisible(); // text
    await expect(popup.getByAltText('Imagen de prueba E2E')).toBeVisible(); // image
    await expect(popup.getByAltText('Imagen y texto E2E')).toBeVisible(); // imageText
    await expect(popup.getByText('Texto compuesto E2E.')).toBeVisible(); // imageText
    await expect(popup.getByRole('link', { name: 'Ir a publicar' })).toHaveAttribute('href', '/publicar'); // cta
    await expect(popup.getByText('Una cita construida en E2E')).toBeVisible(); // quote
    await expect(popup.getByText('Autor E2E')).toBeVisible(); // quote
    await expect(popup.getByText('¿Pregunta E2E?')).toBeVisible(); // faq
    await expect(popup.getByRole('link', { name: 'Buscar anuncios' })).toHaveAttribute('href', '/busqueda'); // hub
    await expect(popup.getByText('Paso uno E2E', { exact: true })).toBeVisible(); // steps
    await expect(popup.getByText('Descripción del paso uno E2E.')).toBeVisible(); // steps
    await expect(popup.getByText('Ana E2E')).toBeVisible(); // profile
    await expect(popup.getByText('10 años')).toBeVisible(); // profile
    await expect(popup.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible(); // video
    await expect(popup.getByText('Cabecera E2E')).toBeVisible(); // table
    await expect(popup.getByText('celda-1-1')).toBeVisible(); // table
    await expect(popup.getByText('Anuncios destacados E2E')).toBeVisible(); // listings (título)
    await expect(popup.getByText(listingTitle)).toBeVisible(); // listings (anuncio real)
    await expect(popup.locator('[data-orientation="horizontal"]')).toBeVisible(); // separator (Radix Separator.Root)

    await popup.close();
  });
});
