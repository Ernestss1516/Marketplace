// UXV.5 — el EDITOR en secciones.
//
// Lo que fija esta batería: que cambiar un campo ya no cuesta cinco pantallas (A4), que
// el guardado está siempre a mano, que salir con cambios avisa en vez de descartar en
// silencio, y que el ALTA sigue siendo un wizard — editar y publicar divergen a propósito.

import { test, expect } from './fixtures/auth';

/** Abre el editor del primer anuncio del vendedor. */
async function abrirEditor(page: import('@playwright/test').Page) {
  await page.goto('/mis-anuncios');
  const editar = page.locator('[data-testid^="listing-card-"]').first().getByRole('link', {
    name: 'Editar',
  });
  await expect(editar).toBeVisible({ timeout: 15_000 });
  await editar.click();
  await page.waitForURL(/\/editar$/, { timeout: 15_000 });
  await expect(page.getByTestId('seccion-datos')).toBeVisible({ timeout: 15_000 });
}

test.describe('UXV.5 (A4) — editar deja de ser un alta', () => {
  test('las secciones están TODAS en pantalla; no hay «Siguiente» que recorrer', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await abrirEditor(page);

    // Antes: solo «Fotos» visible, y las otras cuatro detrás de otros tantos clics.
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();

    // El wizard ha desaparecido de la edición.
    await expect(page.getByRole('button', { name: 'Siguiente' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Anterior' })).toHaveCount(0);
  });

  test('cambiar el precio: abrir, tocar y guardar — sin pasar por ninguna otra sección', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    let payload: Record<string, unknown> | null = null;
    await page.route('**/listings/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        payload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', slug: 'y' }),
        });
        return;
      }
      await route.fallback();
    });

    await abrirEditor(page);

    // El guardado está a la vista desde el primer momento (antes: solo en el último paso).
    await expect(page.getByTestId('guardar-cambios')).toBeVisible();

    await page.locator('#price').fill('123');
    await page.getByTestId('guardar-cambios').click();

    await expect.poll(() => payload, { timeout: 15_000 }).not.toBeNull();
    expect((payload as unknown as { price: number }).price).toBe(123);

    // Y avisa por el canal de UXV.3.
    await expect(page.locator('[data-sonner-toaster]')).toContainText(/cambios guardados/i, {
      timeout: 10_000,
    });
  });

  test('guardar envía el anuncio COMPLETO — no se pierde nada por no abrir una sección', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    let payload: Record<string, unknown> | null = null;
    await page.route('**/listings/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        payload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', slug: 'y' }),
        });
        return;
      }
      await route.fallback();
    });

    await abrirEditor(page);
    await page.getByTestId('guardar-cambios').click();
    await expect.poll(() => payload, { timeout: 15_000 }).not.toBeNull();

    const p = payload as unknown as Record<string, unknown>;
    for (const campo of ['title', 'description', 'price', 'priceType', 'city', 'province', 'tags', 'imageIds']) {
      expect(p, `falta «${campo}» en el PATCH`).toHaveProperty(campo);
    }
  });
});

test.describe('UXV.5 — salir con cambios avisa, no descarta en silencio', () => {
  test('«Cancelar» con cambios pendientes pregunta antes de irse', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await abrirEditor(page);

    // Sin tocar nada, no hay nada que avisar.
    await expect(page.getByTestId('aviso-sin-guardar')).toHaveCount(0);

    await page.locator('#title').fill('Título cambiado sin guardar');
    await expect(page.getByTestId('aviso-sin-guardar')).toBeVisible();

    await page.getByTestId('cancelar-edicion').click();
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible({ timeout: 10_000 });
    await expect(dialogo).toContainText(/se pierden/i);

    // «Seguir editando» deja al usuario donde estaba, con sus cambios.
    await dialogo.getByRole('button', { name: /seguir editando/i }).click();
    await expect(page).toHaveURL(/\/editar$/);
    await expect(page.locator('#title')).toHaveValue('Título cambiado sin guardar');
  });

  test('pinchar el menú de la cuenta con cambios pendientes también avisa', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await abrirEditor(page);

    await page.locator('#title').fill('Otro título sin guardar');

    // ESTE es el caso que UXV.2 agravó: el menú lateral está siempre a la vista, a un clic
    // de perder el trabajo. Antes se iba sin decir nada.
    await page
      .getByRole('navigation', { name: /secciones de mi cuenta/i })
      .getByRole('link', { name: 'Mi saldo', exact: true })
      .click();

    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/editar$/);
  });

  test('«Cancelar» SIN cambios se va directo, sin preguntar', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('cancelar-edicion').click();
    await page.waitForURL(/\/mis-anuncios$/, { timeout: 15_000 });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

test.describe('UXV.5 — el ALTA no se toca: publicar sigue siendo un wizard', () => {
  test('/publicar conserva sus pasos y su «Siguiente»', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/publicar');

    // Editar y publicar son tareas distintas: el alta guía porque el usuario no sabe qué
    // falta; la edición no, porque el usuario sabe a qué viene.
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible({
      timeout: 15_000,
    });

    // LO QUE PRUEBA que sigue siendo un wizard: el alta enseña UN paso cada vez. Si aquí
    // apareciesen también «Datos» y «Ubicación», el alta se habría convertido en el editor
    // por accidente — que es exactamente lo que esta tanda NO debía hacer.
    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toHaveCount(0);
    await expect(page.getByTestId('seccion-datos')).toHaveCount(0);
  });
});
