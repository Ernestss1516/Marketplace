// FORMATOS DE PRECIO — RP.3 (wizard): flujo real de punta a punta del selector
// de formato, cruzando las tres ráfagas: el admin configura los formatos de la
// categoría (RP.2), el wizard solo ofrece esos (RP.3) y el backend persiste el
// elegido tras validarlo (RP.1).
//
// Dos costuras que ninguna batería aislada cubre entera:
//   A. Categoría multi-formato → el selector aparece → publicar con "Por hora"
//      → el anuncio queda con PER_HOUR en la API.
//   B. Categoría SIN configurar (el 100% de las de hoy) → el selector NO
//      aparece y el anuncio sale con ONE_TIME. Es el requisito de oro: el
//      formulario de siempre sigue siendo el de siempre.
//
// Setup de categorías vía API admin directa (rápido) — la UI del panel de
// categorías ya se prueba en admin-categorias-tipo.spec.ts y en page.test.tsx.

import path from 'path';
import { test, expect } from './fixtures/auth';
import { loginAdminViaApi, authedPost, authedGet } from './helpers/api';

interface CatRef {
  id: string;
  slug: string;
  name: string;
}

const FOTO_FIXTURE = path.join(__dirname, 'fixtures', 'test-image.png');

async function uploadPhotoAndAdvance(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="foto-input"]').setInputFiles(FOTO_FIXTURE);
  await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
}

test.describe('RP.3 — formato de precio en el wizard', () => {
  let adminToken: string;
  let multiCat: CatRef;
  let plainCat: CatRef;

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAdminViaApi(request, 'admin-e2e@example.com', 'Test1234!');
    const ts = Date.now();

    async function createCategory(body: Record<string, unknown>): Promise<CatRef> {
      const res = await authedPost(request, '/admin/categories', adminToken, body);
      if (res.status() !== 201) {
        throw new Error(
          `[RP3 setup] no se pudo crear categoría "${body.slug}": ${res.status()} ${await res.text()}`,
        );
      }
      const created = await res.json();
      return { id: created.id as string, slug: created.slug as string, name: created.name as string };
    }

    // Varios formatos → hay elección real → el selector se renderiza.
    multiCat = await createCategory({
      name: `RP3 Multi ${ts}`,
      slug: `rp3-multi-${ts}`,
      allowedListingType: 'SERVICE_ONLY',
      allowedPriceUnits: ['ONE_TIME', 'PER_MONTH', 'PER_HOUR'],
    });

    // Sin allowedPriceUnits → efectivo [ONE_TIME] → el selector NO aparece.
    // Es exactamente el estado de todas las categorías anteriores a RP.2.
    plainCat = await createCategory({
      name: `RP3 Simple ${ts}`,
      slug: `rp3-simple-${ts}`,
      allowedListingType: 'SERVICE_ONLY',
    });
  });

  // ── A ────────────────────────────────────────────────────────────────────

  test('A. Categoría multi-formato: el selector ofrece solo lo permitido y publica con PER_HOUR', async ({
    proContext,
    request,
  }) => {
    const page = await proContext.newPage();
    const TITLE = `RP3 Flujo A ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: multiCat.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba RP3 flujo A.');
    await page.locator('#price').fill('15');

    // El selector existe y arranca en ONE_TIME (preselección: pago único si está
    // entre los permitidos).
    const unitSelect = page.getByTestId('price-unit-select');
    await expect(unitSelect).toBeVisible();
    await expect(unitSelect).toContainText('Pago único');

    await unitSelect.click();
    // Solo los tres formatos que la categoría permite.
    await expect(page.getByRole('option', { name: 'Al mes' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Por hora' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'A la semana' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Por sesión' })).toHaveCount(0);

    await page.getByRole('option', { name: 'Por hora' }).click();
    await expect(unitSelect).toContainText('Por hora');

    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await expect(page.locator('h1')).toContainText(TITLE);

    // La verdad está en la API: el anuncio quedó persistido con PER_HOUR.
    const slug = new URL(page.url()).pathname.split('/').pop()!;
    const res = await authedGet(request, `/listings/${slug}`);
    expect(res.status()).toBe(200);
    const listing = await res.json();
    expect(listing.priceUnit).toBe('PER_HOUR');
    expect(listing.priceType).toBe('FIXED');
  });

  // ── B ────────────────────────────────────────────────────────────────────

  test('B. REQUISITO DE ORO: categoría sin configurar → sin selector, y el anuncio sale con ONE_TIME', async ({
    proContext,
    request,
  }) => {
    const page = await proContext.newPage();
    const TITLE = `RP3 Flujo B ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: plainCat.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();

    // El formulario es el de siempre: no se pregunta por el formato.
    await expect(page.getByTestId('price-unit-select')).toHaveCount(0);

    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba RP3 flujo B.');
    await page.locator('#price').fill('200');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    const slug = new URL(page.url()).pathname.split('/').pop()!;
    const res = await authedGet(request, `/listings/${slug}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).priceUnit).toBe('ONE_TIME');
  });

  // ── C ────────────────────────────────────────────────────────────────────

  test('C. "A convenir" conserva el selector; "Gratis" lo oculta', async ({ proContext }) => {
    const page = await proContext.newPage();

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: multiCat.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);
    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();

    await page.getByLabel('A convenir').click();
    await expect(page.getByTestId('price-unit-select')).toBeVisible();

    await page.getByLabel('Gratis').click();
    await expect(page.getByTestId('price-unit-select')).toHaveCount(0);

    await page.getByLabel('Precio fijo').click();
    await expect(page.getByTestId('price-unit-select')).toBeVisible();
  });
});
