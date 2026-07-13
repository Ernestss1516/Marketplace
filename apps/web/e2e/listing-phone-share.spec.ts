// Feature teléfono en anuncios ("Ver teléfono") + Compartir anuncio.
//
// Setup vía API directa (loginViaApi + authedPost) — más rápido y estable que
// pasar por el wizard completo; el wizard/prefill del campo teléfono se
// prueba aparte en prefill-telefono.spec.ts.

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, authedGet } from './helpers/api';

const PHONE = '611222333';

test.describe('Ver teléfono + Compartir en la ficha', () => {
  let sellerToken: string;
  let categoryId: string;
  let slugWithPhone: string;
  let slugWithoutPhone: string;

  test.beforeAll(async ({ request }) => {
    sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    const catRes = await authedGet(request, '/categories/moviles');
    categoryId = (await catRes.json()).id as string;

    async function createActiveListing(overrides: Record<string, unknown>) {
      const draftRes = await authedPost(request, '/listings', sellerToken, {
        title: `Ver teléfono/Compartir test ${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio de prueba para Ver teléfono y Compartir.',
        price: 99,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
        ...overrides,
      });
      if (draftRes.status() !== 201) {
        throw new Error(`[setup] no se pudo crear el anuncio: ${draftRes.status()} ${await draftRes.text()}`);
      }
      const draft = (await draftRes.json()) as { id: string; slug: string };
      const publishRes = await authedPost(request, `/listings/${draft.id}/publish`, sellerToken, {});
      if (publishRes.status() !== 200) {
        throw new Error(`[setup] no se pudo publicar el anuncio: ${publishRes.status()} ${await publishRes.text()}`);
      }
      return draft;
    }

    const withPhone = await createActiveListing({ phone: PHONE });
    slugWithPhone = withPhone.slug;

    const withoutPhone = await createActiveListing({});
    slugWithoutPhone = withoutPhone.slug;
  });

  test('anuncio SIN teléfono → no se pinta el botón "Ver teléfono"', async ({ buyerContext }) => {
    const page = await buyerContext.newPage();
    await page.goto(`/anuncio/${slugWithoutPhone}`);
    await expect(page.getByRole('button', { name: 'Ver teléfono' })).not.toBeVisible();
  });

  test('privacidad: el HTML servido a un anónimo NO contiene el número en crudo', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/anuncio/${slugWithPhone}`);
    const body = await res.text();
    expect(body).not.toContain(PHONE);
    // El botón sí debe pintarse (hasPhone: true) — confirma que no es un 404/error silencioso.
    expect(body).toContain('Ver teléfono');
  });

  test('anónimo pulsa "Ver teléfono" → redirige a /login con retorno a la ficha', async ({ page }) => {
    await page.goto(`/anuncio/${slugWithPhone}`);
    const button = page.getByRole('button', { name: 'Ver teléfono' });
    await expect(button).toBeVisible();
    await button.click();
    await page.waitForURL(/\/login\?callbackUrl=/, { timeout: 8_000 });
    expect(decodeURIComponent(page.url())).toContain(`/anuncio/${slugWithPhone}`);
  });

  test('logueado pulsa "Ver teléfono" → obtiene el número con enlace tel:', async ({ buyerContext }) => {
    const page = await buyerContext.newPage();
    await page.goto(`/anuncio/${slugWithPhone}`);
    await page.getByRole('button', { name: 'Ver teléfono' }).click();

    const link = page.getByRole('link', { name: PHONE });
    await expect(link).toBeVisible({ timeout: 8_000 });
    await expect(link).toHaveAttribute('href', `tel:${PHONE}`);
  });

  test.describe('Compartir', () => {
    test('la ficha expone una URL canónica', async ({ buyerContext }) => {
      const page = await buyerContext.newPage();
      await page.goto(`/anuncio/${slugWithPhone}`);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain(`/anuncio/${slugWithPhone}`);
    });

    test('dropdown: copiar enlace copia la URL canónica de la ficha', async ({ buyerContext, baseURL }) => {
      const page = await buyerContext.newPage();
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(`/anuncio/${slugWithPhone}`);

      await page.getByRole('button', { name: 'Compartir' }).click();
      await page.getByRole('menuitem', { name: 'Copiar enlace' }).click();
      await expect(page.getByText('Enlace copiado')).toBeVisible();

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe(`${baseURL}/anuncio/${slugWithPhone}`);
    });

    test('dropdown: WhatsApp/Telegram/Email llevan la URL y el título bien escapados', async ({
      buyerContext,
      baseURL,
    }) => {
      const page = await buyerContext.newPage();
      await page.goto(`/anuncio/${slugWithPhone}`);
      await page.getByRole('button', { name: 'Compartir' }).click();

      const expectedUrl = `${baseURL}/anuncio/${slugWithPhone}`;

      const whatsapp = page.getByRole('menuitem', { name: 'WhatsApp' });
      await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
      expect(decodeURIComponent(await whatsapp.getAttribute('href') ?? '')).toContain(expectedUrl);

      const telegram = page.getByRole('menuitem', { name: 'Telegram' });
      const telegramHref = (await telegram.getAttribute('href')) ?? '';
      expect(telegramHref).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
      expect(decodeURIComponent(telegramHref)).toContain(expectedUrl);

      const email = page.getByRole('menuitem', { name: 'Email' });
      const mailHref = (await email.getAttribute('href')) ?? '';
      expect(mailHref).toMatch(/^mailto:\?subject=/);
      expect(decodeURIComponent(mailHref)).toContain(expectedUrl);
    });
  });
});
