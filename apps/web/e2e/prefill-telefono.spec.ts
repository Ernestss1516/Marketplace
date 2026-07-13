// Prefill del teléfono del perfil en el wizard de creación — mismo patrón que
// prefill-ubicacion.spec.ts (ver ese archivo): sugerencia editable al crear,
// pero el anuncio conserva su PROPIO teléfono al editar (no el del perfil).

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, authedGet } from './helpers/api';

/** Navigate through the publish wizard until the Ubicación step. */
async function goToUbicacionStep(page: import('@playwright/test').Page) {
  await page.goto('/publicar');
  await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
  await page.getByRole('button', { name: 'Electrónica', exact: true }).click();
  await page.getByRole('button', { name: 'Móviles', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
  await page.locator('#title').fill(`Prefill teléfono test ${Date.now()}`);
  await page.locator('#description').fill('Prueba prefill teléfono.');
  await page.getByLabel('Servicio').click();
  await page.locator('#price').fill('10');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
}

test.describe('Prefill de teléfono del perfil en el wizard', () => {
  test('wizard: usuario SIN teléfono en perfil → campo vacío', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await goToUbicacionStep(page);
    await expect(page.locator('#phone')).toHaveValue('');
  });

  test('wizard: usuario CON teléfono en perfil → prefillado y editable, nunca se publica solo', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
    await page.locator('#phone').fill('699111222');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Perfil actualizado correctamente')).toBeVisible({ timeout: 8_000 });

    await goToUbicacionStep(page);

    // Prefill: sugerido, pero el aviso de publicación es explícito y el campo es editable.
    await expect(page.locator('#phone')).toHaveValue('699111222');
    await expect(page.getByText(/será visible para usuarios registrados/)).toBeVisible();

    await page.locator('#phone').fill('688333444');
    await expect(page.locator('#phone')).toHaveValue('688333444');
  });

  test('editar anuncio: usa el teléfono DEL ANUNCIO, no el del perfil', async ({ sellerContext, request }) => {
    // Perfil del seller quedó en 699111222 tras el test anterior. Creamos un
    // anuncio con OTRO teléfono directamente vía API para aislar el caso del
    // wizard de edición del de creación.
    const token = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    const catRes = await authedGet(request, '/categories/moviles');
    const categoryId = (await catRes.json()).id as string;

    const draftRes = await authedPost(request, '/listings', token, {
      title: `Editar teléfono test ${Date.now()}`,
      description: 'Anuncio de prueba para editar teléfono.',
      price: 25,
      type: 'PRODUCT',
      priceType: 'FIXED',
      condition: 'GOOD',
      categoryId,
      city: 'Madrid',
      province: 'Madrid',
      latitude: 40.4168,
      longitude: -3.7038,
      phone: '677555666',
    });
    const draft = (await draftRes.json()) as { id: string };

    const page = await sellerContext.newPage();
    await page.goto(`/mis-anuncios/${draft.id}/editar`);
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });

    for (let i = 0; i < 4; i++) {
      const heading = await page.locator('h2').first().textContent({ timeout: 5_000 }).catch(() => '');
      if (heading?.includes('Ubicación')) break;
      await page.getByRole('button', { name: 'Siguiente' }).click();
      await page.waitForTimeout(400);
    }
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible({ timeout: 5_000 });

    // Muestra el teléfono DEL ANUNCIO (677555666), NO el del perfil (699111222/688333444).
    await expect(page.locator('#phone')).toHaveValue('677555666');
  });
});
