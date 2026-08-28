// BACKOFFICE A+B — los enlaces centralizados y la completitud de reportes.
//
// Casi nada de lo que se comprueba aquí necesitaba backend nuevo: los snapshots,
// `resolvedBy`/`resolvedAt`, la paginación y `start-review` ya estaban servidos y
// la interfaz no los leía. Estos casos ejercen justamente esa mitad — la única que
// un test de API no puede ver.
//
// La barrera de «ningún enlace público dentro de (admin)» NO está aquí: vive en
// `src/lib/admin-links.test.ts`, que barre el árbol de ficheros. Es más barata y
// no puede escapársele un enlace que ninguna ruta de este spec visite.

import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPatch, authedPost, loginViaApi } from './helpers/api';

const API_BASE = 'http://localhost:3001';

async function tokenComprador(request: APIRequestContext) {
  return loginViaApi(request, 'buyer-e2e@example.com', 'Test1234!');
}

/** Un anuncio ACTIVE del vendedor, para poder denunciarlo. */
async function crearAnuncio(request: APIRequestContext, titulo: string): Promise<string> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const res = await authedPost(request, '/listings', sellerToken, {
    title: titulo,
    description: 'Anuncio de apoyo para el spec de reportes.',
    price: 40,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: raiz.children?.[0]?.id ?? raiz.id,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[reportes] crear anuncio: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string };

  const activar = await request.patch(`${API_BASE}/api/admin/listings/${listing.id}/status`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { status: 'ACTIVE', reason: 'Alta para el spec de reportes' },
  });
  if (!activar.ok()) throw new Error(`[reportes] activar: ${activar.status()}`);
  return listing.id;
}

async function denunciar(
  request: APIRequestContext,
  dto: Record<string, unknown>,
): Promise<string> {
  const res = await authedPost(request, '/moderation/reports', await tokenComprador(request), dto);
  if (!res.ok()) throw new Error(`[reportes] denunciar: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

test.describe('Reportes — el contenido que viajaba sin verse', () => {
  test('LA BARRERA: si el anuncio denunciado se borra, la cola SIGUE diciendo de qué era', async ({
    request,
    adminContext,
  }) => {
    // El `SetNull` de `Report.listingId` existe para que la denuncia sobreviva al
    // borrado del anuncio —antes era `Cascade` y el denunciado podía destruirla
    // borrando lo suyo—. El snapshot `listingTitle` existe para que siga siendo
    // legible. Viajaba en la respuesta y la cola pintaba un guion.
    const titulo = `Denunciado y borrado ${Date.now()}`;
    const listingId = await crearAnuncio(request, titulo);
    await denunciar(request, {
      reason: 'SPAM',
      description: 'Este anuncio es spam y va a desaparecer.',
      listingId,
    });

    // Archivar y eliminar: es la única vía (el borrado exige ARCHIVED + ADMIN).
    await authedPatch(request, `/admin/listings/${listingId}/status`, adminApiToken(), {
      status: 'ARCHIVED',
      reason: 'Para el spec',
    });
    const borrado = await request.delete(`${API_BASE}/api/admin/listings/${listingId}`, {
      headers: { Authorization: `Bearer ${adminApiToken()}` },
    });
    if (!borrado.ok()) throw new Error(`[reportes] borrar: ${borrado.status()}`);

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');

    const fila = page.locator('tr').filter({ hasText: 'Este anuncio es spam' });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    // Sigue nombrando el anuncio…
    await expect(fila).toContainText(titulo);
    // …y dice que ya no está, en vez de ofrecer un enlace muerto.
    await expect(fila.getByTestId('reporte-diana-fantasma')).toBeVisible();
    await expect(fila.locator('a', { hasText: titulo })).toHaveCount(0);
  });

  test('el reportante se puede abrir, y su ficha es la del backoffice', async ({
    request,
    adminContext,
  }) => {
    const listingId = await crearAnuncio(request, `Con reportante ${Date.now()}`);
    const marca = `Reportante enlazado ${Date.now()}`;
    await denunciar(request, { reason: 'FRAUD', description: marca, listingId });

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');
    const fila = page.locator('tr').filter({ hasText: marca });
    await expect(fila).toBeVisible({ timeout: 15_000 });

    await fila.getByTestId('reporte-enlace-reportante').click();
    await expect(page).toHaveURL(/\/admin\/usuarios\//);
    await expect(page.getByTestId('ficha-usuario')).toBeVisible();
  });

  test('quién resolvió y cuándo, que no se pintaban en ninguna parte', async ({
    request,
    adminContext,
  }) => {
    const listingId = await crearAnuncio(request, `Para resolver ${Date.now()}`);
    const marca = `Se va a resolver ${Date.now()}`;
    const reportId = await denunciar(request, {
      reason: 'OTHER',
      description: marca,
      listingId,
    });

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');
    const fila = page.locator('tr').filter({ hasText: marca });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await fila.getByRole('button', { name: 'Resolver' }).click();

    await expect(fila.getByTestId('reporte-resuelto-por')).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByTestId('reporte-resuelto-por')).toContainText('por ');

    // Y en la ficha, con fecha y hora.
    await page.goto(`/admin/reportes/${reportId}`);
    await expect(page.getByTestId('ficha-reporte-resolucion')).toContainText('Cerrada el');
  });
});

test.describe('Reportes — REVIEWING deja de ser un filtro que miente', () => {
  test('«La reviso yo» mueve la denuncia a En revisión, y el filtro la encuentra', async ({
    request,
    adminContext,
  }) => {
    // El endpoint `start-review` existía desde el principio y NADIE lo llamaba: se
    // ofrecía el filtro «En revisión» y ninguna denuncia podía llegar a ese estado.
    const listingId = await crearAnuncio(request, `Para revisar ${Date.now()}`);
    const marca = `Pasa a revision ${Date.now()}`;
    await denunciar(request, { reason: 'INAPPROPRIATE', description: marca, listingId });

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');
    const fila = page.locator('tr').filter({ hasText: marca });
    await expect(fila).toBeVisible({ timeout: 15_000 });

    await fila.getByTestId('reporte-empezar-revision').click();
    await expect(
      page.locator('tr').filter({ hasText: marca }).getByText('En revisión'),
    ).toBeVisible({ timeout: 15_000 });

    // Y el filtro la muestra: es lo que antes no podía ocurrir nunca.
    await page.getByRole('button', { name: 'En revisión', exact: true }).click();
    await expect(page.locator('tr').filter({ hasText: marca })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Reportes — la paginación que el API servía y nadie usaba', () => {
  test('LA BARRERA: con más de 24 denuncias se llega a la 25.ª', async ({
    request,
    adminContext,
  }) => {
    // El backend pagina de 24 en 24 y la interfaz nunca pasaba `page`: se leía
    // «N total» y sólo se podía trabajar con las 24 primeras. La 25.ª era
    // inalcanzable — no «difícil de ver»: imposible.
    //
    // Se denuncia a un USUARIO y no a un anuncio: son 25 POST sueltos sin tener
    // que sembrar 25 anuncios. Y con marca de tiempo en la descripción para que
    // las denuncias de otros tests no confundan el conteo.
    const marca = `PAG-${Date.now()}`;
    const objetivo = (await (
      await authedGet(request, '/admin/users?q=review-target-e2e', adminApiToken())
    ).json()) as { items: { id: string }[] };

    for (let i = 1; i <= 25; i += 1) {
      await denunciar(request, {
        reason: 'OTHER',
        description: `${marca} numero ${i}`,
        reportedUserId: objetivo.items[0].id,
      });
    }

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');

    const mias = page.locator('tr').filter({ hasText: marca });
    await expect(page.getByTestId('reportes-paginacion')).toBeVisible({ timeout: 15_000 });

    // SE CUENTA, NO SE MIRA CUÁL. Las veinticinco se crean en el mismo puñado de
    // milisegundos, así que comparten `createdAt` y el orden entre empates lo
    // decide Postgres: afirmar «la número 1 está en la página 2» es afirmar algo
    // que la base no promete, y fallaría de vez en cuando sin que nada estuviera
    // roto. Lo que la barrera dice de verdad es que se puede LLEGAR a las
    // veinticinco, y eso es una suma.
    const enLaPrimera = await mias.count();
    expect(enLaPrimera).toBe(24);

    await page.getByTestId('reportes-siguiente').click();
    await expect(page.getByText('Página 2 de')).toBeVisible({ timeout: 15_000 });
    await expect(mias).toHaveCount(1);
  });
});

test.describe('Reportes — la ficha de detalle', () => {
  test('muestra la descripción entera, el denunciante con su correo y el anuncio', async ({
    request,
    adminContext,
  }) => {
    const titulo = `Ficha de reporte ${Date.now()}`;
    const listingId = await crearAnuncio(request, titulo);
    const descripcion =
      'Descripción larga de la denuncia, la que la tabla recorta a dos líneas y que es ' +
      'justo el motivo por el que esta pantalla existe: sin leerla entera no se puede ' +
      'distinguir una queja legítima de una represalia.';
    const reportId = await denunciar(request, {
      reason: 'FRAUD',
      description: descripcion,
      listingId,
    });

    const page = await adminContext.newPage();
    await page.goto(`/admin/reportes/${reportId}`);

    await expect(page.getByTestId('ficha-reporte')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(descripcion)).toBeVisible();
    // El correo del denunciante sólo lo sirve este endpoint.
    await expect(page.getByTestId('ficha-reporte-reportante')).toBeVisible();
    await expect(page.getByText('buyer-e2e@example.com')).toBeVisible();
    // Y el vendedor del anuncio denunciado, que el listado no trae.
    await expect(page.getByTestId('ficha-reporte-vendedor')).toBeVisible();

    await page.getByTestId('ficha-reporte-vendedor').click();
    await expect(page).toHaveURL(/\/admin\/usuarios\//);
  });

  test('desde la cola se abre la ficha por el motivo', async ({ request, adminContext }) => {
    const listingId = await crearAnuncio(request, `Cola a ficha ${Date.now()}`);
    const marca = `De la cola a la ficha ${Date.now()}`;
    await denunciar(request, { reason: 'SPAM', description: marca, listingId });

    const page = await adminContext.newPage();
    await page.goto('/admin/reportes');
    const fila = page.locator('tr').filter({ hasText: marca });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await fila.getByTestId('reporte-enlace-ficha').click();
    await expect(page).toHaveURL(/\/admin\/reportes\/[a-z0-9]+/);
    await expect(page.getByTestId('ficha-reporte')).toBeVisible();
  });
});

test.describe('Tickets — los enlaces que salían del backoffice', () => {
  test('LA BARRERA: desde un ticket de un anuncio NO-ACTIVE se llega a su ficha y SE VE', async ({
    request,
    moderatorContext,
  }) => {
    // Esto enlazaba a `/anuncio/{slug}`, que devuelve 404 para todo lo que no esté
    // ACTIVE — o sea, para el caso típico de un ticket de soporte.
    const titulo = `Ticket de anuncio retirado ${Date.now()}`;
    const listingId = await crearAnuncio(request, titulo);
    await authedPatch(request, `/admin/listings/${listingId}/status`, adminApiToken(), {
      status: 'ARCHIVED',
      reason: 'Retirado, y el ticket sigue',
    });

    const usuario = (await (
      await authedGet(request, '/admin/users?q=seller-e2e', adminApiToken())
    ).json()) as { items: { id: string }[] };
    const ticket = await authedPost(request, '/admin/tickets', adminApiToken(), {
      userId: usuario.items[0].id,
      subject: `Sobre ${titulo}`,
      body: 'Consulta sobre un anuncio que ya no está publicado.',
      listingId,
    });
    if (!ticket.ok()) throw new Error(`[reportes] ticket: ${ticket.status()} ${await ticket.text()}`);
    const ticketId = ((await ticket.json()) as { id: string }).id;

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/tickets/${ticketId}`);

    await page.getByTestId('ticket-enlace-anuncio').click();
    await expect(page).toHaveURL(new RegExp(`/admin/anuncios/${listingId}`));
    // Y SE VE, que es la mitad que un 404 no daba. Se mira el `<h1>` de la ficha y
    // no un texto suelto: el título aparece también en el enlace al propio ticket
    // desde la sección «Tickets», y `getByText` casaría con los dos.
    await expect(page.getByTestId('ficha-titulo')).toHaveText(titulo, { timeout: 15_000 });
  });

  test('el usuario del ticket lleva a su ficha de staff, no al perfil público', async ({
    request,
    moderatorContext,
  }) => {
    const usuario = (await (
      await authedGet(request, '/admin/users?q=seller-e2e', adminApiToken())
    ).json()) as { items: { id: string }[] };
    const ticket = await authedPost(request, '/admin/tickets', adminApiToken(), {
      userId: usuario.items[0].id,
      subject: `Enlace de usuario ${Date.now()}`,
      body: 'Para comprobar a dónde lleva el enlace del usuario.',
    });
    const ticketId = ((await ticket.json()) as { id: string }).id;

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/tickets/${ticketId}`);
    await page.getByTestId('ticket-enlace-usuario').click();
    await expect(page).toHaveURL(/\/admin\/usuarios\//);
    await expect(page.getByTestId('ficha-usuario')).toBeVisible();
  });
});
