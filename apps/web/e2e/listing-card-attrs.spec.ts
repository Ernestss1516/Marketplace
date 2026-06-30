// RC5.5 — Playwright E2E: ListingCard muestra cardAttributes por categoría.
//
// Verifica en las dos fuentes de datos:
//   - Postgres (página de categoría): un coche muestra "Marca: Toyota · Año: 2022"
//   - Meilisearch (página de búsqueda): los mismos valores aparecen tras la indexación
// Y que una categoría SIN cardAttributes definidos no rompe la card (sin texto extra).
//
// Prerequisito en seed-test.ts:
//   vehiculos: year (cardAttribute:true), km (no cardAttribute)
//   coches:    brand (cardAttribute:true) — hereda year de vehiculos
//   → cardAttributes efectivos de coches = [{key:'year', label:'Año'}, {key:'brand', label:'Marca'}]

import path from 'path';
import { test, expect } from './fixtures/auth';

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

  test('Categoría Coches (Postgres): card muestra Marca y Año del coche', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `Card Coche RC5.5 ${Date.now()}`;

    await publishCoche(page, TITLE);

    // Navigate to the Coches category page (Postgres path)
    await page.goto('/coches');
    await page.waitForLoadState('networkidle');

    // Find the card link by title
    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();
    await expect(card).toBeVisible({ timeout: 8_000 });

    // Verify cardAttribute values are shown in the card
    // Expected format: "Marca: Toyota · Año: 2022"
    await expect(card).toContainText('Marca: Toyota');
    await expect(card).toContainText('Año: 2022');

    // km does NOT have cardAttribute:true → should NOT appear as a card attr
    // (km=50000 is not marked cardAttribute in seed; only year and brand are)
    await expect(card).not.toContainText('Kilómetros:');
  });

  test('Categoría Coches (Postgres): coche sin valor de brand omite ese atributo (sin "undefined")', async ({ proContext }) => {
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

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Sevilla');
    await page.locator('#province').fill('Sevilla');
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await page.goto('/coches');
    await page.waitForLoadState('networkidle');

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();
    await expect(card).toBeVisible({ timeout: 8_000 });

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

    // Búsqueda page uses Meilisearch. Wait up to 20s for async indexing.
    await page.goto('/busqueda?category=coches');
    await page.waitForLoadState('networkidle');

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE });
    await expect(card).toBeVisible({ timeout: 25_000 });

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

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Zaragoza');
    await page.locator('#province').fill('Zaragoza');
    await page.getByRole('button', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    // Navigate to Moviles category
    await page.goto('/moviles');
    await page.waitForLoadState('networkidle');

    const card = page.locator('a[href*="/anuncio/"]').filter({ hasText: TITLE }).first();
    await expect(card).toBeVisible({ timeout: 8_000 });

    // Card renders without errors (title and price visible)
    await expect(card.locator('p').first()).toContainText(TITLE.slice(0, 15));
    // No cardAttribute rows — no "label: value" pattern from card attrs
    await expect(card).not.toContainText('undefined');
    await expect(card).not.toContainText('Marca:');
    await expect(card).not.toContainText('RAM:');
  });
});
