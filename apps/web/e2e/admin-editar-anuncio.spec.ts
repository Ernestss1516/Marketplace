// P3a — EL MODO EDICIÓN DE LA FICHA, por el navegador.
//
// El backend está cubierto por `admin-editar-anuncio.e2e-spec.ts` (19). Aquí se
// comprueba lo que sólo se ve en la pantalla: que la sección se edita SIN abrir
// un formulario de la ficha entera, que guardar refleja el cambio, y —la barrera,
// otra vez en las DOS direcciones— que editar desde el backoffice no mueve la
// etiqueta interna mientras que editar como dueño sí.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPatch, authedPost, loginViaApi } from './helpers/api';

async function crearAnuncio(request: APIRequestContext, titulo: string): Promise<string> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const res = await authedPost(request, '/listings', sellerToken, {
    title: titulo,
    description: 'Descripción original, la que el staff va a corregir.',
    price: 100,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: raiz.children?.[0]?.id ?? raiz.id,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[p3a] crear falló: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** Marca el anuncio como revisado, para poder observar si el triaje se mueve. */
async function marcarRevisado(request: APIRequestContext, id: string) {
  const r = await authedPatch(request, `/admin/listings/${id}/triage`, adminApiToken(), {
    triage: 'REVIEWED',
  });
  if (!r.ok()) throw new Error(`[p3a] marcar falló: ${r.status()} ${await r.text()}`);
}

async function guardarYEsperar(page: Page, accion: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/admin/listings/') && r.request().method() === 'PATCH',
      { timeout: 20_000 },
    ),
    accion(),
  ]);
}

test.describe('P3a — editar un anuncio desde el backoffice', () => {
  test('LA BARRERA (a): el staff edita y la etiqueta interna NO se mueve', async ({
    moderatorContext,
    request,
  }) => {
    const id = await crearAnuncio(request, `P3a nav ${Date.now()}`);
    await marcarRevisado(request, id);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado');

    await page.getByTestId('ficha-edit-abrir').click();
    await expect(page.getByTestId('ficha-form-anuncio')).toBeVisible();

    await page.getByTestId('ficha-edit-titulo').fill('P3a Título corregido por el equipo');
    await page.getByTestId('ficha-edit-motivo').fill('Título con datos de contacto');
    await guardarYEsperar(page, () => page.getByTestId('ficha-edit-guardar').click());

    // El cambio se refleja...
    await expect(page.getByTestId('ficha-titulo')).toHaveText(
      'P3a Título corregido por el equipo',
      { timeout: 20_000 },
    );
    // ...y la etiqueta sigue donde estaba.
    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado');
  });

  test('LA BARRERA (b): el DUEÑO editando ese mismo anuncio SÍ lo pasa a Editado', async ({
    moderatorContext,
    request,
  }) => {
    // El contraste. Sin él, desactivar la transición para todos dejaría (a) en
    // verde con la señal de P1 muerta.
    const id = await crearAnuncio(request, `P3a dueño ${Date.now()}`);
    await marcarRevisado(request, id);

    const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    const r = await authedPatch(request, `/listings/${id}`, sellerToken, {
      description: 'Descripción cambiada por el dueño después de la revisión.',
    });
    expect(r.ok()).toBe(true);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);

    await expect(page.getByTestId('ficha-triage')).toContainText('Editado');
  });

  test('el motivo es obligatorio: sin él, no se puede guardar', async ({
    moderatorContext,
    request,
  }) => {
    const id = await crearAnuncio(request, `P3a motivo ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-edit-abrir').click();

    await page.getByTestId('ficha-edit-titulo').fill('P3a Otro título');
    // El backend lo exige; la UI no promete un botón que va a fallar.
    await expect(page.getByTestId('ficha-edit-guardar')).toBeDisabled();

    await page.getByTestId('ficha-edit-motivo').fill('Motivo suficiente');
    await expect(page.getByTestId('ficha-edit-guardar')).toBeEnabled();
  });

  test('cancelar no guarda nada', async ({ moderatorContext, request }) => {
    const id = await crearAnuncio(request, `P3a cancelar ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    const tituloOriginal = await page.getByTestId('ficha-titulo').textContent();

    await page.getByTestId('ficha-edit-abrir').click();
    await page.getByTestId('ficha-edit-titulo').fill('P3a Esto no debe guardarse');
    await page.getByTestId('ficha-edit-cancelar').click();

    await expect(page.getByTestId('ficha-titulo')).toHaveText(tituloOriginal!);
  });

  test('la edición queda en el HISTORIAL de la ficha', async ({ moderatorContext, request }) => {
    const id = await crearAnuncio(request, `P3a historial ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-edit-abrir').click();
    await page.getByTestId('ficha-edit-descripcion').fill('Descripción corregida por el equipo.');
    await page.getByTestId('ficha-edit-motivo').fill('Contenido inapropiado');
    await guardarYEsperar(page, () => page.getByTestId('ficha-edit-guardar').click());

    await expect(page.getByTestId('ficha-historial')).toContainText('Edición del equipo', {
      timeout: 20_000,
    });
  });

  test('editar NO saca de la cola a un PENDING_REVIEW', async ({ moderatorContext, request }) => {
    // Editar es de campos; aprobar tiene su vía. Son ejes distintos.
    const id = await crearAnuncio(request, `P3a cola ${Date.now()}`);
    await authedPatch(request, `/admin/listings/${id}/status`, adminApiToken(), {
      status: 'PENDING_REVIEW',
    });

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await expect(page.getByTestId('ficha-estado')).toHaveText('En revisión');

    await page.getByTestId('ficha-edit-abrir').click();
    await page.getByTestId('ficha-edit-titulo').fill('P3a Corregido en cola');
    await page.getByTestId('ficha-edit-motivo').fill('Se corrige mientras espera');
    await guardarYEsperar(page, () => page.getByTestId('ficha-edit-guardar').click());

    await expect(page.getByTestId('ficha-titulo')).toHaveText('P3a Corregido en cola', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('ficha-estado')).toHaveText('En revisión');
  });
});
