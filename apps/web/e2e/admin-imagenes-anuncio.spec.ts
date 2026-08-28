// IMÁGENES EN BACKOFFICE — la galería de /admin/anuncios/[id], ya editable.
//
// El backend sabía hacer esto desde la ráfaga 2b: `ListingImagesService.sync`
// reordena por posición del array, borra las filas que salen y encola las DOS
// claves de R2. Lo que faltaba era que alguien le mandara `imageIds` — la
// interfaz nunca lo hacía. Esto ejercita justamente esa mitad.
//
// El backend está cubierto por `imagenes-anuncio.e2e-spec.ts` (Jest): el orden
// guardado, las dos claves, el mínimo con su negativo del DRAFT, el aislamiento
// entre anuncios, el AuditLog y la fuga del fichero compartido. Aquí sólo lo que
// no se puede comprobar sin navegador: que los controles existen, que respetan el
// mínimo ANTES de pulsar, que el motivo sigue siendo obligatorio, que quitar pide
// confirmación, y que el nuevo orden llega hasta la web pública.

import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, loginViaApi } from './helpers/api';

const API_BASE = 'http://localhost:3001';
const FOTO = path.join(__dirname, 'fixtures', 'test-image.png');

/** Sube una imagen suelta con el token de su dueño y devuelve su id. */
async function subirFoto(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/media/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'foto.png', mimeType: 'image/png', buffer: fs.readFileSync(FOTO) },
    },
  });
  if (!res.ok()) throw new Error(`[fotos] subir falló: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Un anuncio ACTIVE del vendedor con `n` fotos suyas, en orden.
 *
 * Por API y no por el asistente: lo que se prueba aquí es la galería del
 * backoffice, no el wizard de publicar (que ya tiene sus propios specs).
 */
async function anuncioConFotos(
  request: APIRequestContext,
  n: number,
): Promise<{ id: string; slug: string; imageIds: string[] }> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');

  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const categoryId = raiz.children?.[0]?.id ?? raiz.id;

  const imageIds: string[] = [];
  for (let i = 0; i < n; i += 1) imageIds.push(await subirFoto(request, sellerToken));

  const creado = await authedPost(request, '/listings', sellerToken, {
    title: `Fotos backoffice ${Date.now()}`,
    description: 'Anuncio de apoyo para la galería del backoffice.',
    price: 30,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
    imageIds,
  });
  if (!creado.ok()) {
    throw new Error(`[fotos] crear falló: ${creado.status()} ${await creado.text()}`);
  }
  const listing = (await creado.json()) as { id: string; slug: string };

  // A mercado, que es donde el mínimo aplica y donde la ficha pública lo sirve.
  const activar = await request.patch(`${API_BASE}/api/admin/listings/${listing.id}/status`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { status: 'ACTIVE', reason: 'Alta para el spec de fotos' },
  });
  if (!activar.ok()) {
    throw new Error(`[fotos] activar falló: ${activar.status()} ${await activar.text()}`);
  }

  return { id: listing.id, slug: listing.slug, imageIds };
}

/** Enciende o apaga el mínimo desde los ajustes del backoffice. */
async function exigirMinimo(request: APIRequestContext, activo: boolean) {
  const res = await request.patch(`${API_BASE}/api/admin/settings/minPhotosRuleEnabled`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { value: activo },
  });
  if (!res.ok()) {
    throw new Error(`[fotos] ajuste falló: ${res.status()} ${await res.text()}`);
  }
}

test.describe('Imágenes en el backoffice — reordenar', () => {
  test('mover la última al primer puesto cambia la PORTADA en la web pública', async ({
    request,
    moderatorContext,
  }) => {
    const { id, slug } = await anuncioConFotos(request, 3);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await expect(page.getByTestId('ficha-editar-fotos')).toBeVisible({ timeout: 15_000 });

    // La portada de partida, tal y como la sirve la ficha pública.
    const antes = (await (await authedGet(request, `/listings/${slug}`)).json()) as {
      images: { id: string; url: string }[];
    };
    const nuevaPortada = antes.images[2].id;

    await page.getByTestId('ficha-editar-fotos').click();
    await expect(page.getByTestId('ficha-form-fotos')).toBeVisible();

    // La 1.ª lleva el rótulo «Portada»: es lo que reordenar decide de verdad.
    await expect(page.getByTestId('ficha-foto-portada')).toBeVisible();

    // De la 3.ª a la 1.ª, dos saltos.
    await page.getByTestId('ficha-foto-izquierda-2').click();
    await page.getByTestId('ficha-foto-izquierda-1').click();

    await page.getByTestId('ficha-fotos-motivo').fill('Pongo primero la foto que se ve mejor');
    await page.getByTestId('ficha-fotos-guardar').click();
    await expect(page.getByTestId('ficha-form-fotos')).not.toBeVisible({ timeout: 15_000 });

    // LA BARRERA: se lee el EFECTO en la web pública, no el 200. Antes de 2b el
    // camino de staff respondía 200 y no movía nada.
    await expect
      .poll(
        async () => {
          const res = await authedGet(request, `/listings/${slug}`);
          const body = (await res.json()) as { images: { id: string }[] };
          return body.images[0]?.id;
        },
        { timeout: 15_000 },
      )
      .toBe(nuevaPortada);
  });
});

test.describe('Imágenes en el backoffice — eliminar', () => {
  test('quitar una foto pide confirmación y la quita de la ficha pública', async ({
    request,
    moderatorContext,
  }) => {
    const { id, slug } = await anuncioConFotos(request, 3);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-editar-fotos').click();
    await expect(page.getByTestId('ficha-imagen-editable')).toHaveCount(3);

    await page.getByTestId('ficha-foto-quitar-1').click();
    // Hasta guardar es sólo la lista local: nada se ha borrado todavía.
    await expect(page.getByTestId('ficha-imagen-editable')).toHaveCount(2);

    await page.getByTestId('ficha-fotos-motivo').fill('Foto con datos de contacto');
    await page.getByTestId('ficha-fotos-guardar').click();

    // Acción irreversible ⇒ AlertDialog antes (regla de la casa). Y dice cuántas.
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText('¿Quitar 1 foto?');
    await page.getByTestId('ficha-fotos-confirmar').click();

    await expect(page.getByTestId('ficha-form-fotos')).not.toBeVisible({ timeout: 15_000 });

    await expect
      .poll(
        async () => {
          const res = await authedGet(request, `/listings/${slug}`);
          const body = (await res.json()) as { images: unknown[] };
          return body.images.length;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test('reordenar SIN quitar nada no pide confirmación', async ({ request, moderatorContext }) => {
    // El diálogo es por lo irreversible, no por editar. Mover una foto no destruye
    // nada, así que preguntar ahí sería ruido que enseña a confirmar sin leer.
    const { id } = await anuncioConFotos(request, 2);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-editar-fotos').click();
    await page.getByTestId('ficha-foto-izquierda-1').click();
    await page.getByTestId('ficha-fotos-motivo').fill('Sólo cambio el orden');
    await page.getByTestId('ficha-fotos-guardar').click();

    await expect(page.getByRole('alertdialog')).not.toBeVisible();
    await expect(page.getByTestId('ficha-form-fotos')).not.toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Imágenes en el backoffice — el mínimo y el motivo', () => {
  test.afterEach(async ({ request }) => {
    // El interruptor vuelve APAGADO, que es como nace. Los ajustes son estado
    // global de la batería: dejarlo encendido cambiaría specs de más abajo.
    await exigirMinimo(request, false);
  });

  test('con el mínimo encendido, la papelera de la última foto se deshabilita y lo explica', async ({
    request,
    moderatorContext,
  }) => {
    await exigirMinimo(request, true);
    const { id } = await anuncioConFotos(request, 1);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-editar-fotos').click();

    // La barrera es que NO se puede pulsar: el 422 del backend es la red, no el
    // camino. Un botón que falla al pulsarlo sería una pared sin explicación.
    await expect(page.getByTestId('ficha-foto-quitar-0')).toBeDisabled();
    await expect(page.getByTestId('ficha-fotos-minimo')).toContainText(
      'no puede quedarse con menos de 1 foto',
    );
    // Y nombra la salida real del moderador, que no puede añadir fotos ajenas.
    await expect(page.getByTestId('ficha-fotos-minimo')).toContainText('borrador');
  });

  test('con el mínimo encendido pero fotos de sobra, la papelera sigue viva', async ({
    request,
    moderatorContext,
  }) => {
    // El negativo: si el bloqueo no mirara cuántas quedan, esto también estaría
    // deshabilitado y nadie podría quitar una foto nunca.
    await exigirMinimo(request, true);
    const { id } = await anuncioConFotos(request, 3);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-editar-fotos').click();

    await expect(page.getByTestId('ficha-foto-quitar-0')).toBeEnabled();
    await expect(page.getByTestId('ficha-fotos-minimo')).toHaveCount(0);
  });

  test('el motivo sigue siendo obligatorio: sin él no se puede guardar', async ({
    request,
    moderatorContext,
  }) => {
    // El hueco nuevo no puede saltarse lo que P3a fijó para la edición de texto:
    // una edición de staff sin motivo sería indistinguible de una del dueño.
    const { id } = await anuncioConFotos(request, 2);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-editar-fotos').click();
    await page.getByTestId('ficha-foto-izquierda-1').click();

    await expect(page.getByTestId('ficha-fotos-guardar')).toBeDisabled();
    await page.getByTestId('ficha-fotos-motivo').fill('abc'); // menos de 5
    await expect(page.getByTestId('ficha-fotos-guardar')).toBeDisabled();
    await page.getByTestId('ficha-fotos-motivo').fill('Reordeno la galería');
    await expect(page.getByTestId('ficha-fotos-guardar')).toBeEnabled();
  });
});
