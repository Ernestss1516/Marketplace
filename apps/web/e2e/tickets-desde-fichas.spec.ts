// PUNTO 1 DEL LOTE — ABRIR UN TICKET DESDE LAS FICHAS, con el vínculo automático.
//
// EL BACKEND NO SE TOCA, y por eso esta spec es la única barrera nueva: el modelo
// (`Ticket.listingId` + `linkedLabel`), el guard (`assertLinkable`) y el endpoint
// (`POST /admin/tickets`) ya estaban construidos y probados en `tickets-admin.e2e-spec`.
// Lo que faltaba —y lo único que se puede comprobar aquí— es que desde una ficha se
// llega con el vínculo puesto y con el DESTINATARIO COHERENTE.
//
// LA COHERENCIA ES EL PUNTO. `assertLinkable` valida el enlace contra el DESTINATARIO
// del hilo, no contra el agente: «anuncio X» y «usuario Y» sólo son legales juntos si X
// es de Y. La UI no esquiva ese guard — deriva el destinatario del propio anuncio, así
// que la pareja incoherente ni siquiera es representable.

import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, loginViaApi } from './helpers/api';

const SELLER = 'seller-e2e@example.com';

/** Un anuncio DEL VENDEDOR (no del admin): así el destinatario derivado es otra persona
 *  que el agente, que es el caso real y el que hace visible la coherencia. */
async function crearAnuncioDelVendedor(
  request: APIRequestContext,
  titulo: string,
): Promise<{ id: string; sellerId: string; sellerName: string }> {
  const token = await loginViaApi(request, SELLER, 'Test1234!');

  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const categoryId = raiz.children?.[0]?.id ?? raiz.id;

  const res = await authedPost(request, '/listings', token, {
    title: titulo,
    description: 'Anuncio del vendedor para abrir un ticket desde su ficha.',
    price: 30,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[p1] crear anuncio falló: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string };

  // El vendedor, leído del backend (no supuesto): es contra quien se compara el
  // destinatario que la pantalla de destino deriva por su cuenta.
  const ficha = (await (
    await authedGet(request, `/admin/listings/${listing.id}`, adminApiToken())
  ).json()) as { seller: { id: string; name: string } };

  return { id: listing.id, sellerId: ficha.seller.id, sellerName: ficha.seller.name };
}

test.describe('P1 — desde la ficha de ANUNCIO', () => {
  test('LA BARRERA: el ticket nace vinculado al anuncio y dirigido a SU VENDEDOR', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearAnuncioDelVendedor(request, `Ticket desde ficha ${Date.now()}`);
    const page = await moderatorContext.newPage();

    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('ficha-abrir-ticket').click();
    await page.waitForURL(new RegExp(`/admin/tickets/nuevo\\?listingId=${anuncio.id}$`));

    // ── LA COHERENCIA, y sale del servidor, no de la URL ──────────────────────
    // La URL sólo lleva el id del anuncio. El destinatario que se pinta es el
    // VENDEDOR, derivado de la propia respuesta del anuncio.
    await expect(page.getByTestId('ticket-destinatario')).toHaveText(anuncio.sellerName, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('ticket-anuncio-enlazado')).toBeVisible();

    // Y no se puede romper la pareja: mientras haya anuncio no se ofrece cambiar de
    // destinatario, porque el guard lo rechazaría con un 422.
    await expect(page.getByRole('button', { name: 'Cambiar' })).toHaveCount(0);

    const asunto = `Sobre tu anuncio ${Date.now()}`;
    await page.getByLabel('Asunto').fill(asunto);
    await page.getByLabel('Mensaje').fill('Hola, tenemos una duda sobre este anuncio.');
    await page.getByTestId('enviar-admin-ticket').click();

    // El backend ACEPTÓ la pareja: si el destinatario no fuera el vendedor,
    // `assertLinkable` habría respondido 422 y seguiríamos en el formulario.
    await page.waitForURL(/\/admin\/tickets\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByTestId('error-admin-ticket')).toHaveCount(0);

    // El VÍNCULO, leído donde el usuario lo lee: `linkedLabel`, derivado en el
    // servidor del título real. La UI nunca lo mandó.
    await expect(page.getByText('Relacionado')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Ticket desde ficha`, { exact: false })).toBeVisible();

    // ── EL CÍRCULO, que es la prueba de que el vínculo llegó a la BASE ────────
    // La sección «Tickets» de la ficha sale de la relación `Ticket.listingId`. Que el
    // ticket aparezca ahí no se puede fingir con una etiqueta.
    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ficha-tickets')).toContainText(asunto);

    await page.close();
  });

  test('quitar el anuncio enlazado es lo que desbloquea cambiar de destinatario', async ({
    moderatorContext,
    request,
  }) => {
    const anuncio = await crearAnuncioDelVendedor(request, `Ticket desenlazar ${Date.now()}`);
    const page = await moderatorContext.newPage();

    await page.goto(`/admin/tickets/nuevo?listingId=${anuncio.id}`);
    await expect(page.getByTestId('ticket-anuncio-enlazado')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Cambiar' })).toHaveCount(0);

    await page.getByTestId('ticket-quitar-enlace').click();

    // Sin anuncio, la pareja ya no la fija nadie: el destinatario vuelve a ser libre.
    await expect(page.getByTestId('ticket-anuncio-enlazado')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cambiar' })).toBeVisible();

    await page.close();
  });
});

test.describe('P1 — desde la ficha de USUARIO', () => {
  test('el ticket nace dirigido a ESE usuario, y sin anuncio enlazado', async ({
    moderatorContext,
    request,
  }) => {
    // Se reutiliza el vendedor del anuncio sólo para tener un id y un nombre reales.
    const anuncio = await crearAnuncioDelVendedor(request, `Ticket usuario ${Date.now()}`);
    const page = await moderatorContext.newPage();

    await page.goto(`/admin/usuarios/${anuncio.sellerId}`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('usuario-abrir-ticket').click();
    await page.waitForURL(new RegExp(`/admin/tickets/nuevo\\?userId=${anuncio.sellerId}$`));

    await expect(page.getByTestId('ticket-destinatario')).toHaveText(anuncio.sellerName, {
      timeout: 15_000,
    });
    // Desde aquí el hilo va de la PERSONA: no hay anuncio que enlazar.
    await expect(page.getByTestId('ticket-anuncio-enlazado')).toHaveCount(0);

    const asunto = `Sobre tu cuenta ${Date.now()}`;
    await page.getByLabel('Asunto').fill(asunto);
    await page.getByLabel('Mensaje').fill('Hola, queríamos comentarte algo de tu cuenta.');
    await page.getByTestId('enviar-admin-ticket').click();

    await page.waitForURL(/\/admin\/tickets\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByTestId('error-admin-ticket')).toHaveCount(0);
    // Sin vínculo: la tarjeta «Relacionado» sólo se pinta cuando hay `linkedLabel`.
    await expect(page.getByText('Relacionado')).toHaveCount(0);

    // El círculo por el otro lado: el ticket sale en la ficha del usuario.
    await page.goto(`/admin/usuarios/${anuncio.sellerId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('usuario-tickets')).toContainText(asunto);

    await page.close();
  });
});
