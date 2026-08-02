// RC5.5 — Playwright E2E: ListingCard muestra cardAttributes por categoría.
//
// Verifica en las dos fuentes de datos (ambas ahora sobre Meilisearch tras H6.2):
//   - Página de categoría (/coches): un coche muestra "Marca: Toyota · Año: 2022"
//   - Página de búsqueda (/busqueda?category=coches): los mismos valores aparecen
// Y que una categoría SIN cardAttributes definidos no rompe la card (sin texto extra).
//
// Nota H6.2: /[categoria] ahora usa Meilisearch en lugar de Postgres.
// Los timeouts de visibilidad de tarjeta aumentaron de 8 s a 25 s para dar tiempo
// a la indexación asíncrona via BullMQ.
//
// Prerequisito en seed-test.ts:
//   vehiculos: year (cardAttribute:true), km (no cardAttribute)
//   coches:    brand (cardAttribute:true) — hereda year de vehiculos
//   → cardAttributes efectivos de coches = [{key:'year', label:'Año'}, {key:'brand', label:'Marca'}]

import path from 'path';
import { test, expect } from './fixtures/auth';
import { waitForCard } from './helpers/wait-for-card';
import { cruzarPasoEtiquetas } from './helpers/wizard';

// ── Helper: publish a coche via the wizard and return its URL ────────────────

async function publishCoche(
  page: import('@playwright/test').Page,
  title: string,
): Promise<string> {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();

  // exact:true: avoids matching "Vehículos RC5B" from the rc5b backend spec's beforeAll.
  await page.getByRole('button', { name: 'Vehículos', exact: true }).click();
  await page.getByRole('button', { name: 'Coches', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="foto-input"]').setInputFiles(
    path.join(__dirname, 'fixtures', 'test-image.png'),
  );
  await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();

  await page.locator('#title').fill(title);
  await page.locator('#description').fill('Coche de prueba para test RC5.5 cardAttributes.');
  await page.getByLabel('Servicio').click();
  await page.locator('#price').fill('12000');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  await page.locator('#attr-year').fill('2022');
  await page.locator('#attr-km').fill('50000');
  await page.locator('#attr-brand').fill('Toyota');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await cruzarPasoEtiquetas(page);

  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
  await page.locator('#city').fill('Valencia');
  await page.locator('#province').fill('Valencia');
  await page.getByRole('button', { name: 'Revisar' }).click();

  await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar ahora' }).click();
  await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

  return page.url();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('RC5.5 — ListingCard: cardAttributes por categoría', () => {

  test('Categoría Coches (Meilisearch): card muestra Marca y Año del coche', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `Card Coche RC5.5 ${Date.now()}`;

    await publishCoche(page, TITLE);

    // Active polling: reload /coches until the card appears in the SSR snapshot.
    await waitForCard(page, '/coches', TITLE);

    // Card is now in the DOM — re-locate for further assertions.
    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();

    // Verify cardAttribute values are shown in the card
    // Expected format: "Marca: Toyota · Año: 2022"
    await expect(card).toContainText('Marca: Toyota');
    await expect(card).toContainText('Año: 2022');

    // km does NOT have cardAttribute:true → should NOT appear as a card attr
    // (km=50000 is not marked cardAttribute in seed; only year and brand are)
    await expect(card).not.toContainText('Kilómetros:');
  });

  test('Categoría Coches (Meilisearch): coche sin valor de brand omite ese atributo (sin "undefined")', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `Card Coche sin brand ${Date.now()}`;

    // Publish without filling brand (optional field)
    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: 'Vehículos', exact: true }).click();
    await page.getByRole('button', { name: 'Coches', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="foto-input"]').setInputFiles(
      path.join(__dirname, 'fixtures', 'test-image.png'),
    );
    await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Coche sin marca para test RC5.5.');
    await page.getByLabel('Servicio').click();
    await page.locator('#price').fill('9000');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await page.locator('#attr-year').fill('2018');
    await page.locator('#attr-km').fill('90000');
    // brand left empty — optional
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await cruzarPasoEtiquetas(page);

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Sevilla');
    await page.locator('#province').fill('Sevilla');
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await waitForCard(page, '/coches', TITLE);

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();

    // year shows (has value), brand absent (not filled)
    await expect(card).toContainText('Año: 2018');
    await expect(card).not.toContainText('Marca:');
    // No "undefined" leaking
    await expect(card).not.toContainText('undefined');
  });

  test('Búsqueda (Meilisearch): card muestra los mismos cardAttributes', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `Card Meili RC5.5 ${Date.now()}`;

    await publishCoche(page, TITLE);

    await waitForCard(page, '/busqueda?category=coches', TITLE);

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE });

    await expect(card).toContainText('Marca: Toyota');
    await expect(card).toContainText('Año: 2022');
  });

  test('Categoría sin cardAttributes (Electrónica → Móviles): cards no rompen', async ({ proContext }) => {
    const page = await proContext.newPage();

    // Publish a móvil listing (Electrónica → Móviles — neither brand nor ram is cardAttribute in seed)
    const TITLE = `Móvil sin card attrs ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: 'Electrónica' }).click();
    await page.getByRole('button', { name: 'Móviles' }).click();
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="foto-input"]').setInputFiles(
      path.join(__dirname, 'fixtures', 'test-image.png'),
    );
    await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Móvil de prueba RC5.5 sin cardAttributes.');
    await page.getByLabel('Servicio').click();
    await page.locator('#price').fill('200');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    // Atributos step — brand and ram are optional, leave empty
    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await cruzarPasoEtiquetas(page);

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Zaragoza');
    await page.locator('#province').fill('Zaragoza');
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await waitForCard(page, '/moviles', TITLE);

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();

    // Card renders without errors (title and price visible)
    await expect(card.locator('p').first()).toContainText(TITLE.slice(0, 15));
    // No cardAttribute rows — no "label: value" pattern from card attrs
    await expect(card).not.toContainText('undefined');
    await expect(card).not.toContainText('Marca:');
    await expect(card).not.toContainText('RAM:');
  });
});
