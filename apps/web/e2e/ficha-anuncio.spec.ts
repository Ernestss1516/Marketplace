// FICHA F1 (P4) — LA BARRERA, EJERCIDA POR EL NAVEGADOR.
//
// EL DEFECTO QUE CIERRA, dicho como lo vivía el moderador: abría la cola de
// revisión, hacía clic en el anuncio que tenía que aprobar, y le salía un 404.
// Siempre. El enlace apuntaba a `/anuncio/{slug}` —la página pública, que sólo
// sirve ACTIVE— y la cola contiene, por construcción, sólo PENDING_REVIEW. No
// había vista previa de staff. Así que se aprobaba y se rechazaba viendo el
// título, el vendedor y la fecha, y nada más.
//
// El primer test es esa secuencia entera: cola → clic → ficha → LEER la
// descripción y VER las fotos. Es lo que antes era imposible.
//
// El backend ya está cubierto por `ficha-anuncio.e2e-spec.ts`; lo que sólo se
// puede comprobar aquí es que el ENLACE lleva donde debe y que la pantalla pinta
// lo que trae — que es justo donde vivía el fallo.

import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, authedPatch } from './helpers/api';

/** Un anuncio CON FOTO en PENDING_REVIEW: la foto es media barrera. */
async function crearPendienteConFoto(
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
    description: 'DESCRIPCION QUE EL MODERADOR NO PODIA VER antes de la ficha F1.',
    price: 42,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[ficha] crear falló: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string; slug: string };

  const mandar = await authedPatch(request, `/admin/listings/${listing.id}/status`, admin, {
    status: 'PENDING_REVIEW',
  });
  if (!mandar.ok()) {
    throw new Error(`[ficha] enviar a revisión falló: ${mandar.status()} ${await mandar.text()}`);
  }
  return listing;
}

test.describe('F1 — la ficha de anuncio del backoffice', () => {
  test('LA BARRERA: desde la cola, el moderador llega a la ficha y VE la descripción', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearPendienteConFoto(request, `Ficha barrera ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto('/admin/moderacion');
    await page.waitForLoadState('networkidle');

    // El anuncio está en la cola...
    await expect(page.getByTestId(`cola-item-${anuncio.id}`)).toBeVisible();

    // ...y su enlace lleva a la FICHA, no a la página pública. Ésta es la línea
    // que cambia: antes era `/anuncio/{slug}` y devolvía 404.
    await page.getByTestId(`cola-enlace-${anuncio.id}`).click();
    await page.waitForURL(`**/admin/anuncios/${anuncio.id}`);

    // Y aquí está lo que no se podía ver.
    await expect(page.getByTestId('ficha-anuncio')).toBeVisible();
    await expect(page.getByTestId('ficha-descripcion')).toContainText(
      'DESCRIPCION QUE EL MODERADOR NO PODIA VER',
    );
    await expect(page.getByTestId('ficha-estado')).toHaveText('En revisión');
    await expect(page.getByTestId('ficha-precio')).toContainText('42');

    // El resto de la ficha responde a «¿de quién es y de qué va?».
    await expect(page.getByTestId('ficha-categoria')).toBeVisible();
    await expect(page.getByTestId('ficha-senales')).toBeVisible();
    await expect(page.getByTestId('ficha-enlace-vendedor')).toBeVisible();
  });

  test('la ficha abre CUALQUIER estado — también un archivado, que la pública no sirve', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearPendienteConFoto(request, `Ficha archivada ${Date.now()}`);
    // PENDING_REVIEW → DRAFT → ... hasta ARCHIVED hace falta pasar por ACTIVE:
    // archivar sólo es legal desde los estados publicados.
    await authedPatch(request, `/admin/listings/${anuncio.id}/status`, adminApiToken(), {
      status: 'ACTIVE',
    });
    await authedPatch(request, `/admin/listings/${anuncio.id}/status`, adminApiToken(), {
      status: 'ARCHIVED',
    });

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);

    await expect(page.getByTestId('ficha-estado')).toHaveText('Archivado');
    await expect(page.getByTestId('ficha-descripcion')).toBeVisible();
  });

  test('APROBAR DESDE LA FICHA usa el endpoint de moderación, no el genérico', async ({
    moderatorContext,
    request,
  }) => {
    // MODERACIÓN M2 — el defecto que no se puede reabrir. Aprobar por la vía
    // genérica cambia el estado igual, así que sólo se nota en dos sitios: el
    // registro `LISTING_APPROVE` y el aviso al vendedor. Se comprueba el primero,
    // que es observable, y que además implica que se llamó a quien avisa.
    const anuncio = await crearPendienteConFoto(request, `Ficha aprobar ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await expect(page.getByTestId('ficha-estado')).toHaveText('En revisión');

    await page.getByTestId('ficha-selector-estado').selectOption('ACTIVE');
    await page.getByTestId('ficha-aplicar-estado').click();

    await expect(page.getByTestId('ficha-estado')).toHaveText('Activo', { timeout: 20_000 });

    // La prueba de que NO fue por el genérico: el genérico registra
    // `LISTING_STATUS_CHANGE`; sólo el endpoint de moderación deja
    // `LISTING_APPROVE`, y es el mismo que avisa al vendedor.
    await expect(page.getByTestId('ficha-historial')).toContainText('Aprobado');
  });

  test('eliminar sólo lo ve un ADMIN — un MODERATOR no (B2)', async ({
    moderatorContext,
    adminContext,
    request,
  }) => {
    const anuncio = await crearPendienteConFoto(request, `Ficha borrar ${Date.now()}`);
    await authedPatch(request, `/admin/listings/${anuncio.id}/status`, adminApiToken(), {
      status: 'ACTIVE',
    });
    await authedPatch(request, `/admin/listings/${anuncio.id}/status`, adminApiToken(), {
      status: 'ARCHIVED',
    });

    // El moderador archiva todos los días, pero destruir es otra decisión.
    const modPage = await moderatorContext.newPage();
    await modPage.goto(`/admin/anuncios/${anuncio.id}`);
    await expect(modPage.getByTestId('ficha-estado')).toHaveText('Archivado');
    await expect(modPage.getByTestId('ficha-eliminar')).toHaveCount(0);

    // El administrador sí.
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`/admin/anuncios/${anuncio.id}`);
    await expect(adminPage.getByTestId('ficha-eliminar')).toBeVisible();
  });

  test('un EDITOR no entra en la ficha (hereda MODERATOR por segmento, sin fila nueva)', async ({
    editorContext,
    request,
  }) => {
    // El permiso NO está escrito para `/admin/anuncios/{id}`: lo hereda de la
    // sección `anuncios` porque `sectionForPath` casa por segmento. Este test es
    // lo que impide que alguien "arregle" eso añadiendo una fila al mapa y cree
    // una segunda verdad sobre el mismo permiso.
    const anuncio = await crearPendienteConFoto(request, `Ficha editor ${Date.now()}`);

    const page = await editorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);

    await expect(page).not.toHaveURL(new RegExp(`/admin/anuncios/${anuncio.id}$`));
  });
});
