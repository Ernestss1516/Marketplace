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

// ─────────────────────────────────────────────────────────────────────────────
// 2a — LOS ATRIBUTOS EN EL MODO EDICIÓN
// ─────────────────────────────────────────────────────────────────────────────
//
// Se apoya en el árbol que la semilla de test declara a propósito:
//
//     Vehículos   → year (Año, REQUIRED) · km (Kilómetros, REQUIRED)
//       └ Coches  → brand (Marca)
//
// Un anuncio en Coches tiene por tanto TRES atributos efectivos, dos de ellos
// heredados y obligatorios — que es justo lo que `GET /admin/listings/:id` no
// devolvía: su `category` es la fila cruda de la HOJA, con `brand` y nada más.

/** Un anuncio en Coches, con los tres atributos efectivos puestos. */
async function crearCoche(request: APIRequestContext, titulo: string): Promise<string> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
  const coches = (await (await authedGet(request, '/categories/coches')).json()) as { id: string };

  const res = await authedPost(request, '/listings', sellerToken, {
    title: titulo,
    description: 'Un coche con atributos heredados de Vehículos.',
    price: 9000,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: coches.id,
    attributes: { year: 2020, km: 50000, brand: 'Seat' },
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[2a] crear coche falló: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** Los atributos tal y como están GUARDADOS, sin pasar por la pantalla. */
async function atributosDe(
  request: APIRequestContext,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await authedGet(request, `/admin/listings/${id}`, adminApiToken());
  return ((await r.json()) as { attributes: Record<string, unknown> }).attributes ?? {};
}

test.describe('2a — el staff edita los atributos', () => {
  test('la ficha enseña los HEREDADOS, no sólo los de la hoja', async ({
    moderatorContext,
    request,
  }) => {
    // Antes de 2a esta ficha pintaba `category.attributeSchema` —la fila cruda de
    // Coches—, así que enseñaba «Marca» y se callaba «Año» y «Kilómetros». La
    // validación del backend, en cambio, siempre corrió sobre la cadena entera.
    const id = await crearCoche(request, `2a herencia ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);

    const atributos = page.getByTestId('ficha-atributos');
    await expect(atributos).toBeVisible({ timeout: 20_000 });
    await expect(atributos).toContainText('Marca');
    await expect(atributos).toContainText('Año');
    await expect(atributos).toContainText('Kilómetros');
  });

  test('LA BARRERA: edita un atributo, el triaje no se mueve y NO se pierden los demás', async ({
    moderatorContext,
    request,
  }) => {
    const id = await crearCoche(request, `2a editar ${Date.now()}`);
    await marcarRevisado(request, id);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado');

    await page.getByTestId('ficha-edit-abrir').click();
    await expect(page.getByTestId('ficha-edit-atributos')).toBeVisible();

    // El formulario trae los TRES, con sus valores.
    await expect(page.getByLabel('Marca')).toHaveValue('Seat');
    await expect(page.getByLabel('Año *')).toHaveValue('2020');

    await page.getByLabel('Marca').fill('Renault');
    await page.getByTestId('ficha-edit-motivo').fill('La marca estaba mal escrita');
    await guardarYEsperar(page, () => page.getByTestId('ficha-edit-guardar').click());

    await expect(page.getByTestId('ficha-atributos')).toContainText('Renault', {
      timeout: 20_000,
    });

    // ── LA MITAD QUE DE VERDAD IMPORTA ────────────────────────────────────────
    // `attributes` se guarda por REEMPLAZO COMPLETO del jsonb, y la validación
    // corre sobre el bag MEZCLADO. Un formulario construido con el schema de la
    // hoja habría mandado `{brand}` a secas: la validación lo habría dado por
    // bueno —porque mezcla con lo guardado— y la escritura habría BORRADO `year`
    // y `km`, en silencio y dejando el anuncio inválido. Se afirma contra la
    // base, no contra la pantalla.
    const guardados = await atributosDe(request, id);
    expect(guardados.brand).toBe('Renault');
    expect(guardados.year).toBe(2020);
    expect(guardados.km).toBe(50000);

    // Y el cuidado de P3a sigue en pie: esto es edición de STAFF.
    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado');
  });

  test('valida IGUAL que el dueño: vaciar un requerido heredado frena el guardado', async ({
    moderatorContext,
    request,
  }) => {
    // POR QUÉ EL FRENO ES DE CLIENTE, y no es una rebaja. El backend valida
    // `attributes` sobre el bag MEZCLADO (lo guardado + lo que llega) pero lo ESCRIBE
    // por reemplazo completo, así que vaciar un REQUERIDO se le cuela: el formulario no
    // manda un valor vacío, la validación lo recupera de lo guardado y lo aprueba, y la
    // escritura lo borra. Es un hueco del backend que afecta IGUAL al camino del dueño
    // —que sólo está a salvo porque su formulario frena antes—, y está anotado como tal.
    // Que el backoffice frene en el MISMO sitio, con la MISMA función (`attributeErrors`),
    // es lo que hace cierta la promesa de P3a mientras el hueco se cierra aparte.
    const id = await crearCoche(request, `2a validar ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${id}`);
    await page.getByTestId('ficha-edit-abrir').click();
    await expect(page.getByTestId('ficha-edit-atributos')).toBeVisible();
    await page.getByTestId('ficha-edit-motivo').fill('Prueba de validación');

    // Con todo relleno se puede guardar...
    await expect(page.getByTestId('ficha-edit-guardar')).toBeEnabled();

    // ...y al vaciar `year` —REQUIRED y declarado en el ANCESTRO— deja de poder. Que
    // frene por un atributo HEREDADO es lo que demuestra que el formulario mira la
    // cadena entera y no sólo la hoja.
    await page.getByLabel('Año *').fill('');
    await expect(page.getByTestId('ficha-edit-guardar')).toBeDisabled();
    await expect(page.getByTestId('ficha-edit-atributos')).toContainText('Año es obligatorio');

    // Se recupera al rellenarlo otra vez: es un freno, no un callejón.
    await page.getByLabel('Año *').fill('2021');
    await expect(page.getByTestId('ficha-edit-guardar')).toBeEnabled();

    // Y nada se ha guardado por el camino.
    const guardados = await atributosDe(request, id);
    expect(guardados.year).toBe(2020);
  });
});
