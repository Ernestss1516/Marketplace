// ETIQUETA INTERNA (P1) — RÁFAGA E2: la etiqueta se ve y se usa.
//
// El backend está cubierto por `etiqueta-interna.e2e-spec.ts` (20) y
// `ficha-filtros.e2e-spec.ts` (40). Aquí se comprueba lo que sólo se ve en la
// pantalla: que las DOS insignias se distinguen, que `EDITED` no se ofrece como
// opción manual, y que el filtro devuelve exactamente lo etiquetado.
//
// Las esperas van con `waitForResponse`, no con `networkidle`: los filtros
// navegan y la lista se recarga con un fetch del cliente. Es la lección que dejó
// una mutación en F2 — `networkidle` puede volver antes y la aserción corre
// contra el render anterior.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPatch, authedPost } from './helpers/api';

async function crearAnuncio(
  request: APIRequestContext,
  titulo: string,
): Promise<{ id: string; slug: string }> {
  const admin = adminApiToken();
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const categoryId = raiz.children?.[0]?.id ?? raiz.id;

  const res = await authedPost(request, '/listings', admin, {
    title: titulo,
    description: `Anuncio de prueba de la etiqueta interna: ${titulo}`,
    price: 21,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[p1] crear falló: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; slug: string };
}

/** Pone la etiqueta por API, para partir del estado que el test necesita. */
async function marcar(
  request: APIRequestContext,
  id: string,
  cambio: { triage?: string; watched?: boolean },
) {
  const r = await authedPatch(request, `/admin/listings/${id}/triage`, adminApiToken(), cambio);
  if (!r.ok()) throw new Error(`[p1] marcar falló: ${r.status()} ${await r.text()}`);
}

async function filtrarYEsperar(page: Page, accion: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/admin/listings') && !/\/admin\/listings\//.test(r.url()),
      { timeout: 20_000 },
    ),
    accion(),
  ]);
}

test.describe('P1/E2 — la etiqueta interna, vista y usada', () => {
  test('LA BARRERA: filtrar por «En observación» devuelve SÓLO los observados', async ({
    moderatorContext,
    request,
  }) => {
    const ts = Date.now();
    const vigilado = await crearAnuncio(request, `P1 vigilado ${ts}`);
    const tranquilo = await crearAnuncio(request, `P1 tranquilo ${ts}`);
    await marcar(request, vigilado.id, { watched: true });

    const page = await moderatorContext.newPage();
    await page.goto('/admin/anuncios');
    await page.waitForLoadState('networkidle');
    // Los dos están antes de filtrar — sin este control, el test pasaría igual
    // aunque el filtro no se hubiese aplicado.
    await expect(page.getByTestId(`anuncio-enlace-${tranquilo.id}`)).toBeVisible();

    await filtrarYEsperar(page, () => page.getByTestId('filtro-watched').click());

    await expect(page.getByTestId(`anuncio-enlace-${vigilado.id}`)).toBeVisible();
    await expect(page.getByTestId(`anuncio-enlace-${tranquilo.id}`)).toHaveCount(0);
  });

  test('el triaje filtra, admite varios y se COMBINA con la observación', async ({
    moderatorContext,
    request,
  }) => {
    const ts = Date.now();
    const revisadoVigilado = await crearAnuncio(request, `P1 rv ${ts}`);
    const soloRevisado = await crearAnuncio(request, `P1 sr ${ts}`);
    await marcar(request, revisadoVigilado.id, { triage: 'REVIEWED', watched: true });
    await marcar(request, soloRevisado.id, { triage: 'REVIEWED' });

    const page = await moderatorContext.newPage();
    await page.goto('/admin/anuncios');
    await page.waitForLoadState('networkidle');

    await filtrarYEsperar(page, () => page.getByTestId('filtro-triage-REVIEWED').click());
    await expect(page.getByTestId(`anuncio-enlace-${soloRevisado.id}`)).toBeVisible();

    // Y al añadir el otro eje, se acota: «los revisados que además vigilamos».
    await filtrarYEsperar(page, () => page.getByTestId('filtro-watched').click());
    await expect(page.getByTestId(`anuncio-enlace-${revisadoVigilado.id}`)).toBeVisible();
    await expect(page.getByTestId(`anuncio-enlace-${soloRevisado.id}`)).toHaveCount(0);

    // Los dos controles quedan puestos a la vez: son ejes independientes.
    await expect(page.getByTestId('filtro-triage-REVIEWED')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page).toHaveURL(/triage=REVIEWED/);
    await expect(page).toHaveURL(/watched=true/);
  });

  test('la ficha enseña LOS DOS EJES, distinguibles', async ({ moderatorContext, request }) => {
    const anuncio = await crearAnuncio(request, `P1 dos ejes ${Date.now()}`);
    await marcar(request, anuncio.id, { triage: 'REVIEWED', watched: true });

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);

    // El estado del anuncio y la etiqueta interna son insignias SEPARADAS.
    await expect(page.getByTestId('ficha-estado')).toBeVisible();
    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado');
    await expect(page.getByTestId('ficha-watched')).toContainText('En observación');
  });

  test('EDITED se pinta con su CUÁNDO, y NO se ofrece como opción manual', async ({
    moderatorContext,
    request,
  }) => {
    // `EDITED` sólo lo pone el sistema: la transición automática al editar el
    // dueño. Ofrecerlo a mano sería permitir afirmar un hecho falso — el backend
    // lo rechaza con 400 y la UI no debe prometer el botón.
    const anuncio = await crearAnuncio(request, `P1 editado ${Date.now()}`);
    await marcar(request, anuncio.id, { triage: 'REVIEWED' });
    // El dueño (aquí, el propio admin que lo creó) edita → REVIEWED pasa a EDITED.
    const r = await authedPatch(request, `/listings/${anuncio.id}`, adminApiToken(), {
      description: 'Descripción cambiada por el dueño.',
    });
    expect(r.ok()).toBe(true);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);

    await expect(page.getByTestId('ficha-triage')).toContainText('Editado');
    // El «cuándo», que sale de `updatedAt` porque la transición automática no
    // deja fila de historial (E1).
    await expect(page.getByTestId('ficha-triage-cuando')).toBeVisible();

    // Y los únicos botones manuales son Nuevo y Revisado.
    await expect(page.getByTestId('ficha-marcar-NEW')).toBeVisible();
    await expect(page.getByTestId('ficha-marcar-REVIEWED')).toBeVisible();
    await expect(page.getByTestId('ficha-marcar-EDITED')).toHaveCount(0);
  });

  test('marcar REVIEWED desde la ficha se refleja y queda en el HISTORIAL', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearAnuncio(request, `P1 marcar ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await expect(page.getByTestId('ficha-triage')).toContainText('Nuevo');

    await page.getByTestId('ficha-marcar-REVIEWED').click();

    await expect(page.getByTestId('ficha-triage')).toContainText('Revisado', { timeout: 20_000 });
    // El cambio MANUAL sí deja traza (E1), y la ficha ya la pinta desde F1.
    await expect(page.getByTestId('ficha-historial')).toContainText('Etiqueta interna');
  });

  test('poner en observación NO cambia el estado del anuncio', async ({
    moderatorContext,
    request,
  }) => {
    // La ortogonalidad, vista desde la pantalla: vigilar no despublica.
    const anuncio = await crearAnuncio(request, `P1 ortogonal ${Date.now()}`);
    await authedPatch(request, `/admin/listings/${anuncio.id}/status`, adminApiToken(), {
      status: 'ACTIVE',
    });

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await expect(page.getByTestId('ficha-estado')).toHaveText('Activo');

    await page.getByTestId('ficha-alternar-watched').click();

    await expect(page.getByTestId('ficha-watched')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ficha-estado')).toHaveText('Activo');
  });

  test('la insignia se ve en la LISTA, sin entrar en la ficha', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearAnuncio(request, `P1 lista ${Date.now()}`);
    await marcar(request, anuncio.id, { triage: 'REVIEWED', watched: true });

    const page = await moderatorContext.newPage();
    await page.goto('/admin/anuncios');
    await page.waitForLoadState('networkidle');

    const celda = page.getByTestId(`anuncio-triage-${anuncio.id}`);
    await expect(celda).toContainText('Revisado');
    await expect(celda).toContainText('En observación');
  });
});
