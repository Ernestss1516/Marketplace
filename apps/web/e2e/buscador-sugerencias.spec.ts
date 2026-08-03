// BÚSQUEDA+TAGS B4 — el buscador de portada con sugerencia de etiquetas.
//
// Lo que solo se ve aquí: el debounce, el desplegable en dos bloques, el teclado, y
// sobre todo el DESTINO — elegir una etiqueta lleva a la URL canónica de A1 filtrada
// por B3, no a una búsqueda de texto. Ahí es donde el bloque A y el B se tocan.
//
// El ranking, el ámbito por categoría y el caso de 0 anuncios se prueban en
// `tags-b4.e2e-spec.ts`, donde son deterministas.
//
// El seed de test (B1) da a `coches`: "Único dueño" (propio) y "Con garantía" /
// "Envío incluido" (heredados de vehiculos).

import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';

/** Escribe en el buscador de la home y espera al desplegable. */
async function teclear(page: Page, texto: string) {
  const input = page.getByPlaceholder('¿Qué estás buscando?');
  await input.fill(texto);
  return input;
}

const desplegable = (page: Page) => page.getByTestId('sugerencias-etiquetas');

test.describe('B4 — sugerencias del buscador de portada', () => {
  test('teclear sugiere etiquetas, con su conteo', async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'garant');

    await expect(desplegable(page)).toBeVisible();
    const opcion = desplegable(page).getByRole('option', { name: /Con garantía/ });
    await expect(opcion).toBeVisible();
    // El conteo se muestra siempre, incluso a 0 (P6).
    await expect(opcion).toContainText(/\(\d+\)/);
  });

  test('por debajo del mínimo de caracteres no se sugiere nada', async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'g');
    await expect(desplegable(page)).toHaveCount(0);
  });

  test('un texto sin coincidencias ofrece solo la salida de escape', async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'zzzznadaquecase');

    await expect(desplegable(page)).toBeVisible();
    await expect(desplegable(page).getByText('Ninguna etiqueta coincide.')).toBeVisible();
    // El texto libre sigue estando: nunca se deja al usuario sin salida.
    await expect(page.getByTestId('buscar-texto-libre')).toBeVisible();
  });

  test('elegir una etiqueta CON categoría lleva a la URL anidada de A1 + ?tags=', { tag: '@2b' }, async ({
    page,
  }) => {
    // Donde A y B se tocan: /vehiculos/coches?tags=..., no /busqueda?category=coches.
    await page.goto('/');
    await page.getByLabel('Categoría').selectOption('coches');
    await teclear(page, 'único');

    await desplegable(page).getByRole('option', { name: /Único dueño/ }).click();

    await page.waitForURL(
      (url) =>
        url.pathname === '/vehiculos/coches' && url.searchParams.get('tags') === 'unico-dueno',
      { waitUntil: 'commit' },
    );
  });

  test('elegir una etiqueta SIN categoría lleva a /busqueda?tags=', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'garant');

    await desplegable(page).getByRole('option', { name: /Con garantía/ }).click();

    await page.waitForURL(
      (url) => url.pathname === '/busqueda' && url.searchParams.get('tags') === 'garantia',
      { waitUntil: 'commit' },
    );
  });

  test('la provincia elegida viaja con la etiqueta', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Provincia').selectOption('Madrid');
    await teclear(page, 'garant');

    await desplegable(page).getByRole('option', { name: /Con garantía/ }).click();

    await page.waitForURL(
      (url) =>
        url.searchParams.get('tags') === 'garantia' &&
        url.searchParams.get('province') === 'Madrid',
      { waitUntil: 'commit' },
    );
  });

  // ── El requisito de oro: el buscador de siempre sigue funcionando ────────────

  test('Enter SIN elegir sugerencia hace la búsqueda de texto libre de siempre', { tag: '@2b' }, async ({
    page,
  }) => {
    await page.goto('/');
    const input = await teclear(page, 'bicicleta plegable');
    await expect(desplegable(page)).toBeVisible();

    await input.press('Enter');

    await page.waitForURL(
      (url) =>
        url.pathname === '/busqueda' && url.searchParams.get('q') === 'bicicleta plegable',
      { waitUntil: 'commit' },
    );
  });

  test('la salida de escape del desplegable también busca texto libre', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'garant');

    await page.getByTestId('buscar-texto-libre').click();

    await page.waitForURL(
      (url) => url.pathname === '/busqueda' && url.searchParams.get('q') === 'garant',
      { waitUntil: 'commit' },
    );
  });

  // ── Teclado ─────────────────────────────────────────────────────────────────

  test('flecha abajo + Enter elige la primera sugerencia', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    const input = await teclear(page, 'único');
    await expect(desplegable(page).getByRole('option', { name: /Único dueño/ })).toBeVisible();

    await input.press('ArrowDown');
    await input.press('Enter');

    await page.waitForURL((url) => url.searchParams.get('tags') === 'unico-dueno', {
      waitUntil: 'commit',
    });
  });

  test('Esc cierra el desplegable sin navegar', async ({ page }) => {
    await page.goto('/');
    const input = await teclear(page, 'garant');
    await expect(desplegable(page)).toBeVisible();

    await input.press('Escape');
    await expect(desplegable(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('un clic fuera cierra el desplegable', async ({ page }) => {
    await page.goto('/');
    await teclear(page, 'garant');
    await expect(desplegable(page)).toBeVisible();

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(desplegable(page)).toHaveCount(0);
  });
});
