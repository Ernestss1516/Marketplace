// Atención al usuario R6 — frontend de usuario, flujo real en navegador.
//
// Cubre lo que solo se puede comprobar con el navegador delante: que la entrada
// contextual arrastra la entidad enlazada, que el hilo pinta cada lado en su
// sitio, y que las ACCIONES QUE SE OFRECEN dependen del estado y del origen del
// ticket (matriz §7.2). La lógica de negocio ya está cubierta por los e2e de
// backend; aquí se verifica la capa que decide qué se enseña.
//
// El `page` por defecto de Playwright NO está autenticado: las sesiones vienen
// de los contextos con storageState del fixture (sellerContext), igual que en
// mensajeria-unificada.spec.ts. Setup de datos vía API directa (loginViaApi +
// authedPost), más rápido y estable que pasar por formularios.

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, authedGet } from './helpers/api';

test.describe('Tickets — área de usuario', () => {
  let sellerToken: string;
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    // El ADMIN entra por /auth/admin-login: /auth/login rechaza admins con 403
    // (lección de R5 de facturación — un token vacío haría "pasar" los tests
    // por el motivo equivocado).
    const res = await request.post('http://localhost:3001/api/auth/admin-login', {
      data: { email: 'admin-e2e@example.com', password: 'Test1234!' },
    });
    expect(res.ok()).toBeTruthy();
    adminToken = (await res.json()).accessToken as string;
    expect(adminToken).toBeTruthy();
  });

  /** Abre un ticket por API y devuelve su id. */
  async function abrirTicket(
    request: Parameters<typeof authedPost>[0],
    subject: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authedPost(request, '/tickets', sellerToken, {
      subject,
      body: 'Cuerpo del ticket de prueba',
      ...extra,
    });
    expect(res.status()).toBe(201);
    return (await res.json()).id as string;
  }

  test('abre un ticket desde cero y aparece en la lista como abierto', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    const subject = `Ticket UI ${Date.now()}`;

    await page.goto('/mis-tickets/nuevo');
    await page.getByLabel('Asunto').fill(subject);
    await page.getByLabel('Mensaje').fill('No consigo hacer una cosa y necesito ayuda.');
    await page.getByTestId('enviar-ticket').click();

    // Redirige al hilo recién creado.
    await expect(page).toHaveURL(/\/mis-tickets\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { name: subject })).toBeVisible();
    await expect(page.getByTestId('ticket-status')).toHaveText('Abierto');

    // Y figura en la lista.
    await page.goto('/mis-tickets');
    await expect(page.getByTestId('lista-tickets')).toContainText(subject);
  });

  test('la entrada contextual de un anuncio prefija la entidad enlazada', async ({
    sellerContext,
    request,
  }) => {
    const page = await sellerContext.newPage();

    const catRes = await authedGet(request, '/categories/moviles');
    const categoryId = (await catRes.json()).id as string;
    const title = `Anuncio para ticket ${Date.now()}`;

    const draft = await authedPost(request, '/listings', sellerToken, {
      title,
      description: 'Descripción del anuncio de prueba para el ticket',
      price: 100,
      type: 'PRODUCT',
      priceType: 'FIXED',
      categoryId,
      city: 'Madrid',
      province: 'Madrid',
    });
    expect(draft.status()).toBe(201);
    const listingId = (await draft.json()).id as string;

    // Se llega como llegaría el usuario desde la tarjeta de /mis-anuncios.
    await page.goto(`/mis-tickets/nuevo?listingId=${listingId}`);
    await expect(page.getByTestId('entidad-enlazada')).toContainText(title);

    await page.getByLabel('Asunto').fill(`Problema con el anuncio ${Date.now()}`);
    await page.getByLabel('Mensaje').fill('El anuncio no se ve como esperaba.');
    await page.getByTestId('enviar-ticket').click();

    await expect(page).toHaveURL(/\/mis-tickets\/[a-z0-9]+$/);
    // El linkedLabel lo derivó el SERVIDOR del título real, no el query param.
    await expect(page.getByTestId('entidad-enlazada')).toContainText(title);
  });

  test('el hilo pinta cada lado en su sitio y responder mueve el estado', async ({
    sellerContext,
    request,
  }) => {
    const page = await sellerContext.newPage();
    const ticketId = await abrirTicket(request, `Hilo UI ${Date.now()}`);

    // El staff responde → el ticket pasa a WAITING_USER.
    const reply = await authedPost(request, `/admin/tickets/${ticketId}/messages`, adminToken, {
      body: 'Hola, lo estamos revisando.',
    });
    expect(reply.status()).toBe(201);

    await page.goto(`/mis-tickets/${ticketId}`);
    await expect(page.getByTestId('ticket-status')).toHaveText('Esperando tu respuesta');
    await expect(page.getByTestId('mensaje-user')).toBeVisible();
    await expect(page.getByTestId('mensaje-staff')).toContainText('lo estamos revisando');

    // El usuario responde → T5: WAITING_USER → IN_PROGRESS. El estado lo dicta
    // el backend; la UI solo refleja lo que le devuelve.
    await page.getByTestId('input-respuesta').fill('Ahí van más detalles.');
    await page.getByTestId('enviar-respuesta').click();

    await expect(page.getByTestId('hilo-mensajes')).toContainText('Ahí van más detalles.');
    await expect(page.getByTestId('ticket-status')).toHaveText('En curso');
  });

  test('un ticket propio ofrece «ya no lo necesito»; uno abierto por la administración, no', async ({
    sellerContext,
    request,
  }) => {
    const page = await sellerContext.newPage();

    // (a) Ticket del usuario → sí ofrece cerrar.
    const propio = await abrirTicket(request, `Propio ${Date.now()}`);
    await page.goto(`/mis-tickets/${propio}`);
    await expect(page.getByTestId('cerrar-ticket')).toBeVisible();

    // (b) Hilo abierto por la administración (origin=ADMIN) → NO lo ofrece: el
    // backend responde 403, así que la UI directamente no enseña el botón.
    const meRes = await authedGet(request, '/users/me', sellerToken);
    const sellerId = (await meRes.json()).id as string;

    const delAdmin = await authedPost(request, '/admin/tickets', adminToken, {
      userId: sellerId,
      subject: `Revisión de cuenta ${Date.now()}`,
      body: 'Necesitamos que confirmes un dato.',
    });
    expect(delAdmin.status()).toBe(201);
    const adminTicketId = (await delAdmin.json()).id as string;

    await page.goto(`/mis-tickets/${adminTicketId}`);
    await expect(page.getByTestId('ticket-status')).toHaveText('Esperando tu respuesta');
    await expect(page.getByTestId('cerrar-ticket')).toHaveCount(0);
    // Pero sí puede responder: el hilo está vivo.
    await expect(page.getByTestId('input-respuesta')).toBeVisible();
  });

  test('un ticket cerrado no ofrece caja de respuesta, sino «abrir uno nuevo»', async ({
    sellerContext,
    request,
  }) => {
    const page = await sellerContext.newPage();
    const ticketId = await abrirTicket(request, `Para cerrar ${Date.now()}`);
    const cerrar = await authedPost(request, `/tickets/${ticketId}/close`, sellerToken, {});
    expect(cerrar.status()).toBe(200);

    await page.goto(`/mis-tickets/${ticketId}`);
    await expect(page.getByTestId('ticket-status')).toHaveText('Cerrado');
    await expect(page.getByTestId('form-respuesta')).toHaveCount(0);
    await expect(page.getByTestId('ticket-cerrado')).toContainText('cerrado');
    await expect(page.getByRole('link', { name: 'Abrir un ticket nuevo' })).toBeVisible();
  });

  test('un ticket RESUELTO dentro de ventana ofrece reabrir respondiendo', async ({
    sellerContext,
    request,
  }) => {
    const page = await sellerContext.newPage();
    const ticketId = await abrirTicket(request, `Para resolver ${Date.now()}`);
    await authedPost(request, `/admin/tickets/${ticketId}/take`, adminToken, {});
    const resolver = await authedPost(request, `/admin/tickets/${ticketId}/resolve`, adminToken, {});
    expect(resolver.status()).toBe(200);

    await page.goto(`/mis-tickets/${ticketId}`);
    await expect(page.getByTestId('ticket-status')).toHaveText('Resuelto');
    // Responder ES reabrir (T8): el botón lo dice, y no hay endpoint /reopen.
    await expect(page.getByTestId('enviar-respuesta')).toContainText('Reabrir y responder');

    await page.getByTestId('input-respuesta').fill('Sigue sin funcionar.');
    await page.getByTestId('enviar-respuesta').click();

    await expect(page.getByTestId('ticket-status')).toHaveText('En curso');
  });

  test('/mis-tickets exige sesión', async ({ browser }) => {
    // Contexto limpio, sin storageState: el middleware debe mandar a /login.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/mis-tickets');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
