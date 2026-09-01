/**
 * BLOQUE DE PUBLICIDAD EXTERNA (ajuste 5) — las barreras de punta a punta.
 *
 * QUÉ SE PRUEBA AQUÍ Y NO EN UNITARIOS: que el tipo existe en el selector, que la subida de
 * imagen funciona contra el almacenamiento real, y que **lo que se publica es lo que se ve**
 * en las DOS superficies del motor de contenido (un artículo de blog y una página).
 *
 * El detalle del `target`/`rel` —todas las combinaciones de destino × interruptor— vive en
 * `src/components/blocks/AdBannerBlockRenderer.test.tsx`, que es donde se puede enumerar la
 * matriz entera en milisegundos. Aquí sólo se comprueba que esa disciplina llega de verdad al
 * HTML publicado, que es lo que un unitario no puede afirmar.
 *
 * Prerequisites: global-setup siembra editor-e2e@example.com (EDITOR).
 */

import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

async function addBlock(page: Page, label: string) {
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByTestId('block-type-picker').getByText(label, { exact: true }).click();
}

/** Sube la imagen del banner y espera a que el preview confirme que aterrizó. */
async function subirImagen(fila: Locator) {
  await fila.getByTestId('block-adbanner-input').setInputFiles(TEST_IMAGE);
  await expect(fila.getByAltText('Preview')).toBeVisible({ timeout: 20_000 });
}

test.describe('Bloque de publicidad — el editor y lo publicado', () => {
  test('EDITOR publica una PÁGINA con un banner completo y el público lo ve entero', async ({
    editorContext,
  }) => {
    test.setTimeout(120_000);
    const page = await editorContext.newPage();
    const suffix = Date.now();
    const title = `Página con publicidad ${suffix}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    await addBlock(page, 'Publicidad');
    const fila = page.getByTestId('block-row-adBanner');
    await expect(fila).toBeVisible();

    await subirImagen(fila);
    await fila.getByTestId('block-adbanner-title').fill(`Oferta ${suffix}`);
    await fila.getByPlaceholder('p.ej. Ver oferta').fill('Ver la oferta');

    // AVISO, NO ERROR: con texto de botón y sin enlace, el botón no se pintaría. El editor lo
    // dice; el esquema no lo rechaza (tumbar el guardado del post entero por un bloque a
    // medio rellenar sería peor).
    await expect(fila.getByTestId('block-adbanner-aviso-cta')).toBeVisible();

    await fila.getByTestId('block-adbanner-href').fill('https://ejemplo.com/oferta');
    await expect(fila.getByTestId('block-adbanner-aviso-cta')).toHaveCount(0);
    await fila.getByTestId('block-adbanner-nueva-pestana').check();

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 15_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    const banner = popup.getByTestId('bloque-publicidad');
    await expect(banner).toBeVisible();
    await expect(banner.getByText(`Oferta ${suffix}`)).toBeVisible();

    // LA BARRERA QUE IMPORTA, en el HTML de verdad: pestaña nueva ⇒ noopener, siempre.
    const enlace = banner.getByTestId('bloque-publicidad-enlace');
    await expect(enlace).toHaveAttribute('href', 'https://ejemplo.com/oferta');
    await expect(enlace).toHaveAttribute('target', '_blank');
    const rel = (await enlace.getAttribute('rel')) ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    // Es un enlace publicitario: se le dice a los buscadores que no le pasen autoridad.
    expect(rel).toContain('sponsored');

    await popup.close();
  });

  test('en un POST de blog, y con SOLO la imagen: sin textos ni botón, sin huecos rotos', async ({
    editorContext,
  }) => {
    // La otra superficie del mismo motor, y el caso mínimo: un banner que es sólo una imagen
    // es un banner válido (la imagen es lo único obligatorio).
    test.setTimeout(120_000);
    const page = await editorContext.newPage();
    const suffix = Date.now();
    const title = `Post con publicidad ${suffix}`;

    await page.goto('/admin/blog/nuevo');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    await addBlock(page, 'Publicidad');
    await subirImagen(page.getByTestId('block-row-adBanner'));

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/blog\/.+\/editar/, { timeout: 15_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver en blog/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    const banner = popup.getByTestId('bloque-publicidad');
    await expect(banner).toBeVisible();
    await expect(banner.locator('img')).toBeVisible();
    // Ni botón ni textos: los opcionales ausentes no dejan restos.
    await expect(banner.getByTestId('bloque-publicidad-enlace')).toHaveCount(0);

    await popup.close();
  });

  test('la PORTADA no ofrece este bloque — es de contenido, no de configuración', async ({
    adminContext,
  }) => {
    // Los dos motores son independientes y `adBanner` sólo se registró en el de contenido.
    // Si algún día se quisiera en portada, hay que registrarlo allí a propósito.
    const page = await adminContext.newPage();
    await page.goto('/admin/portada');
    await expect(page.getByTestId('zona-bloques')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('zona-bloques').getByRole('button', { name: 'Añadir bloque' }).click();
    const picker = page.getByTestId('home-block-type-picker');
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId('home-block-type-adBanner')).toHaveCount(0);
  });
});
