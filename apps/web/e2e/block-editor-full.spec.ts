// SISTEMA DE BLOQUES — Ráfaga 2, prueba de fuego: un admin (simulado)
// construye una página completa con los 9 tipos de bloque desde
// /admin/paginas/nueva, la publica, y se verifica que /paginas/[slug] la
// renderiza con el MISMO BlockRenderer que usa el preview del editor — "lo
// que ve el admin es lo que se publica".
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import * as path from 'path';
import { test, expect } from './fixtures/auth';

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

async function addBlock(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByTestId('block-type-picker').getByText(label, { exact: true }).click();
}

test.describe('Editor de bloques — construir una página completa con los 9 tipos', () => {
  test('ADMIN añade los 9 bloques, guarda, publica, y el público los ve todos', async ({ adminContext }) => {
    test.setTimeout(90_000);
    const page = await adminContext.newPage();
    const suffix = Date.now();
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

    // 3. cta
    await addBlock(page, 'Botón destacado');
    const ctaRow = page.getByTestId('block-row-cta');
    await ctaRow.getByPlaceholder('p.ej. Publicar anuncio').fill('Ir a publicar');
    await ctaRow.getByPlaceholder('/publicar o https://...').fill('/publicar');

    // 4. quote
    await addBlock(page, 'Cita');
    const quoteRow = page.getByTestId('block-row-quote');
    await quoteRow.getByPlaceholder('La frase que quieres destacar').fill('Una cita construida en E2E');
    await quoteRow.getByPlaceholder('Nombre de quien lo dijo').fill('Autor E2E');

    // 5. faq (ya trae 1 sub-ítem por defecto)
    await addBlock(page, 'Preguntas frecuentes');
    const faqRow = page.getByTestId('block-row-faq');
    await faqRow.getByPlaceholder('Pregunta', { exact: true }).fill('¿Pregunta E2E?');
    await faqRow.getByPlaceholder('Respuesta', { exact: true }).fill('Respuesta E2E.');

    // 6. hub (ya trae 1 sub-ítem por defecto)
    await addBlock(page, 'Enlaces relacionados');
    const hubRow = page.getByTestId('block-row-hub');
    await hubRow.getByPlaceholder('Texto del enlace').fill('Buscar anuncios');
    await hubRow.getByPlaceholder('/busqueda o https://...').fill('/busqueda');

    // 7. video
    await addBlock(page, 'Vídeo');
    const videoRow = page.getByTestId('block-row-video');
    await videoRow.getByPlaceholder(/youtube\.com/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(videoRow.locator('iframe')).toBeVisible();

    // 8. separator
    await addBlock(page, 'Separador');
    await expect(page.getByTestId('block-row-separator')).toBeVisible();

    // 9. table — tocar también añadir fila/columna, la parte más cara del editor.
    await addBlock(page, 'Tabla');
    const tableRow = page.getByTestId('block-row-table');
    await tableRow.getByPlaceholder('Columna 1').fill('Cabecera E2E');
    await tableRow.getByRole('button', { name: 'Columna', exact: true }).click();
    await tableRow.getByRole('button', { name: 'Añadir fila' }).click();
    const cells = tableRow.locator('tbody input');
    await cells.nth(0).fill('celda-1-1');
    await cells.nth(1).fill('celda-1-2');

    // Preview: el mismo BlockRenderer que el sitio público.
    await page.getByRole('button', { name: /ver preview/i }).click();
    await expect(page.getByText('Encabezado E2E')).toBeVisible();
    await expect(page.getByText('Una cita construida en E2E')).toBeVisible();
    await page.getByRole('button', { name: /ocultar preview/i }).click();

    // Guardar + publicar.
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // --- Verificar en público: los 9 bloques presentes ---
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    await expect(popup.locator('h1', { hasText: title })).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'Encabezado E2E' })).toBeVisible(); // text
    await expect(popup.getByText('negrita')).toBeVisible(); // text
    await expect(popup.getByAltText('Imagen de prueba E2E')).toBeVisible(); // image
    await expect(popup.getByRole('link', { name: 'Ir a publicar' })).toHaveAttribute('href', '/publicar'); // cta
    await expect(popup.getByText('Una cita construida en E2E')).toBeVisible(); // quote
    await expect(popup.getByText('Autor E2E')).toBeVisible(); // quote
    await expect(popup.getByText('¿Pregunta E2E?')).toBeVisible(); // faq
    await expect(popup.getByRole('link', { name: 'Buscar anuncios' })).toHaveAttribute('href', '/busqueda'); // hub
    await expect(popup.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible(); // video
    await expect(popup.locator('[data-orientation="horizontal"]')).toBeVisible(); // separator (Radix Separator.Root)
    await expect(popup.getByText('Cabecera E2E')).toBeVisible(); // table
    await expect(popup.getByText('celda-1-1')).toBeVisible(); // table

    await popup.close();
  });
});
