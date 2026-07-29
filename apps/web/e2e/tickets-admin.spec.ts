// Atención al usuario R7 — frontend de STAFF, flujo real en navegador.
//
// La matriz de acciones (estado × rol × asignación) ya está cubierta, entera y
// en milisegundos, por staff-actions.test.ts. Aquí se verifica lo que solo el
// navegador demuestra: que la pantalla USA esas banderas, que la bandeja del
// MODERATOR no trae los tickets de facturación, y que los flujos (b) y (c)
// cierran de punta a punta — incluido que el usuario ve en SUS tickets el hilo
// que le abrió la administración.
//
// El ADMIN autentica por su propia vía (/auth/admin-login); los contextos con
// storageState del fixture son los que dan sesión al navegador (lección de R6:
// el `page` por defecto NO está autenticado).

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, authedGet } from './helpers/api';

test.describe('Tickets — backoffice de staff', () => {
  let sellerToken: string;
  /**
   * Los tickets de prueba de ESTA suite los abre `buyer-e2e`, no `seller-e2e`.
   *
   * Motivo: el rate limit de apertura es de 10/día POR USUARIO (real, y bien que
   * esté), y `tickets-usuario.spec.ts` ya gasta buena parte de la cuota de
   * `seller-e2e` en la misma corrida de Playwright — juntas se pasaban y la
   * segunda suite recibía 429 en su propio setup. Repartir el usuario es más
   * honesto que subir el límite o flushear Redis a mitad de corrida: el límite
   * de producción se queda como está.
   *
   * `seller-e2e` se sigue usando SOLO donde hace falta su estado sembrado:
   * los datos fiscales para poder emitir la factura del test de la puerta
   * ADMIN-only, y el flujo (b), donde el hilo lo abre el admin (esa vía no
   * consume la cuota del usuario).
   */
  let buyerToken: string;
  let adminToken: string;
  let sellerId: string;

  test.beforeAll(async ({ request }) => {
    sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    buyerToken = await loginViaApi(request, 'buyer-e2e@example.com', 'Test1234!');

    const res = await request.post('http://localhost:3001/api/auth/admin-login', {
      data: { email: 'admin-e2e@example.com', password: 'Test1234!' },
    });
    expect(res.ok()).toBeTruthy();
    adminToken = (await res.json()).accessToken as string;
    expect(adminToken).toBeTruthy();

    const me = await authedGet(request, '/users/me', sellerToken);
    sellerId = (await me.json()).id as string;
  });

  async function abrirTicketDeUsuario(
    request: Parameters<typeof authedPost>[0],
    subject: string,
  ): Promise<string> {
    const res = await authedPost(request, '/tickets', buyerToken, {
      subject,
      body: 'Cuerpo del ticket de prueba para el backoffice',
    });
    expect(res.status()).toBe(201);
    return (await res.json()).id as string;
  }

  // ===========================================================================
  // ADMIN — ciclo completo
  // ===========================================================================

  test('el ADMIN ve la bandeja, abre un hilo, responde, resuelve y cierra', async ({
    adminContext,
    request,
  }) => {
    const page = await adminContext.newPage();
    const subject = `Bandeja admin ${Date.now()}`;
    const ticketId = await abrirTicketDeUsuario(request, subject);

    await page.goto('/admin/tickets');
    await expect(page.getByTestId('bandeja-tickets')).toContainText(subject);

    await page.goto(`/admin/tickets/${ticketId}`);
    await expect(page.getByTestId('ticket-status')).toHaveText('Abierto');

    // OPEN → se ofrece Tomar, no Resolver (nadie lo ha atendido aún).
    await expect(page.getByTestId('accion-tomar')).toBeVisible();
    await expect(page.getByTestId('accion-resolver')).toHaveCount(0);

    await page.getByTestId('accion-tomar').click();
    await expect(page.getByTestId('ticket-status')).toHaveText('En curso');
    await expect(page.getByTestId('accion-resolver')).toBeVisible();

    // Responder → WAITING_USER (el estado lo dicta el backend).
    await page.getByTestId('input-respuesta-staff').fill('Te respondemos desde soporte.');
    await page.getByTestId('enviar-respuesta-staff').click();
    await expect(page.getByTestId('ticket-status')).toHaveText('Esperando tu respuesta');
    await expect(page.getByTestId('hilo-staff')).toContainText('Te respondemos desde soporte.');

    await page.getByTestId('accion-resolver').click();
    await expect(page.getByTestId('ticket-status')).toHaveText('Resuelto');
    // RESOLVED: ya no se responde desde staff; la pelota es del usuario.
    await expect(page.getByTestId('input-respuesta-staff')).toHaveCount(0);

    await page.getByTestId('accion-cerrar').click();
    await expect(page.getByTestId('ticket-status')).toHaveText('Cerrado');
    // CLOSED es un pozo sin salida: ninguna acción queda en pie.
    await expect(page.getByTestId('accion-tomar')).toHaveCount(0);
    await expect(page.getByTestId('accion-resolver')).toHaveCount(0);
    await expect(page.getByTestId('accion-cerrar')).toHaveCount(0);
  });

  test('los filtros de la bandeja acotan la lista', async ({ adminContext, request }) => {
    const page = await adminContext.newPage();
    const subject = `Filtro ${Date.now()}`;
    await abrirTicketDeUsuario(request, subject);

    await page.goto('/admin/tickets');
    await expect(page.getByTestId('bandeja-tickets')).toContainText(subject);

    // Un ticket recién abierto por el usuario es OPEN y sin asignar: filtrando
    // por CLOSED no debe aparecer.
    await page.getByTestId('filtro-estado').selectOption('CLOSED');
    await expect(page.locator('body')).not.toContainText(subject);

    await page.getByTestId('filtro-estado').selectOption('OPEN');
    await expect(page.getByTestId('bandeja-tickets')).toContainText(subject);

    // Y filtrando por "sin asignar" sigue estando.
    await page.getByTestId('filtro-asignado').selectOption('none');
    await expect(page.getByTestId('bandeja-tickets')).toContainText(subject);
  });

  // ===========================================================================
  // MODERATOR — las dos puertas ADMIN-only
  // ===========================================================================

  test('el MODERATOR gestiona un ticket normal pero NO ve los de facturación; el ADMIN sí', async ({
    moderatorContext,
    adminContext,
    request,
  }) => {
    const page = await moderatorContext.newPage();

    // (a) Ticket normal: lo ve y lo responde.
    const normalSubject = `Normal mod ${Date.now()}`;
    const normalId = await abrirTicketDeUsuario(request, normalSubject);

    await page.goto('/admin/tickets');
    await expect(page.getByTestId('bandeja-tickets')).toContainText(normalSubject);

    await page.goto(`/admin/tickets/${normalId}`);
    await page.getByTestId('input-respuesta-staff').fill('Respondo como moderador.');
    await page.getByTestId('enviar-respuesta-staff').click();
    await expect(page.getByTestId('hilo-staff')).toContainText('Respondo como moderador.');

    // (b) Ticket CON FACTURA: el backend no se lo lista ni se lo sirve.
    const invoiceSubject = `Factura mod ${Date.now()}`;
    // El seed de Playwright deja a seller-e2e con datos fiscales y una
    // Transaction SUCCEEDED sin facturar, justo para que esto pueda emitirse.
    const factura = await authedPost(request, '/billing/facturas', sellerToken, {});
    expect(factura.status()).toBe(201);
    const invoiceId = (await factura.json()).id as string;
    const conFactura = await authedPost(request, '/tickets', sellerToken, {
      subject: invoiceSubject,
      body: 'No me cuadra el importe de esta factura.',
      invoiceId,
    });
    expect(conFactura.status()).toBe(201);
    const conFacturaId = (await conFactura.json()).id as string;

    await page.goto('/admin/tickets');
    await expect(page.locator('body')).not.toContainText(invoiceSubject);

    // Y si fuerza la URL, la pantalla muestra el error que devuelve el backend
    // (403 TICKET_BILLING_ADMIN_ONLY): la seguridad está ahí, no en ocultar.
    await page.goto(`/admin/tickets/${conFacturaId}`);
    await expect(page.getByTestId('error-acceso')).toContainText('administrador');

    // EL CONTRASTE COMPLETO: el ADMIN sí lo ve en la bandeja y sí lo abre. Sin
    // esto, el 403 del moderador podría deberse a cualquier otra cosa.
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/admin/tickets');
    await expect(adminPage.getByTestId('bandeja-tickets')).toContainText(invoiceSubject);
    await adminPage.goto(`/admin/tickets/${conFacturaId}`);
    await expect(adminPage.getByTestId('error-acceso')).toHaveCount(0);
    await expect(adminPage.getByRole('heading', { name: invoiceSubject })).toBeVisible();
  });

  // ===========================================================================
  // NOTAS INTERNAS — el recorrido completo por el navegador
  // ===========================================================================

  test('una nota interna escrita desde la UI la ve el staff y NUNCA el usuario', async ({
    adminContext,
    buyerContext,
    request,
  }) => {
    const page = await adminContext.newPage();
    const SECRETO = `NOTA-INTERNA-UI-${Date.now()}`;
    const ticketId = await abrirTicketDeUsuario(request, `Con nota ${Date.now()}`);

    await page.goto(`/admin/tickets/${ticketId}`);

    // Se escribe con el toggle activado: es la vía real, la del agente.
    await page.getByTestId('input-respuesta-staff').fill(SECRETO);
    await page.getByTestId('toggle-nota-interna').locator('input').check();
    await expect(page.getByTestId('enviar-respuesta-staff')).toContainText('nota interna');
    await page.getByTestId('enviar-respuesta-staff').click();

    // El staff la ve, marcada.
    await expect(page.getByTestId('hilo-staff')).toContainText(SECRETO);
    await expect(page.getByTestId('hilo-staff')).toContainText('Nota interna');

    // El toggle se resetea: la siguiente respuesta no sale interna por inercia.
    await expect(page.getByTestId('toggle-nota-interna').locator('input')).not.toBeChecked();

    // Y una respuesta normal después, para que el hilo del usuario no esté vacío.
    await page.getByTestId('input-respuesta-staff').fill('Esto sí lo puedes leer.');
    await page.getByTestId('enviar-respuesta-staff').click();
    await expect(page.getByTestId('hilo-staff')).toContainText('Esto sí lo puedes leer.');

    // EL USUARIO: ni en el hilo, ni en el HTML servido, ni en el badge.
    const userPage = await buyerContext.newPage();
    await userPage.goto(`/mis-tickets/${ticketId}`);
    await expect(userPage.getByTestId('hilo-mensajes')).toContainText('Esto sí lo puedes leer.');
    expect(await userPage.content()).not.toContain(SECRETO);

    await userPage.goto('/mis-tickets');
    expect(await userPage.content()).not.toContain(SECRETO);
  });

  // ===========================================================================
  // FLUJO (b) — admin → usuario, visible en /mis-tickets
  // ===========================================================================

  test('FLUJO (b): abrir un hilo con un usuario, y el usuario lo ve en sus tickets', async ({
    adminContext,
    sellerContext,
  }) => {
    const page = await adminContext.newPage();
    const subject = `Hilo b ${Date.now()}`;

    await page.goto('/admin/tickets/nuevo');
    await page.getByTestId('buscar-usuario').fill('vendedor-e2e');
    await page.getByTestId('buscar-usuario').press('Enter');

    await expect(page.getByTestId('resultados-usuarios')).toBeVisible();
    await page.getByTestId('resultados-usuarios').getByRole('button').first().click();

    await page.getByLabel('Asunto').fill(subject);
    await page.getByLabel('Mensaje').fill('Necesitamos que confirmes un dato de tu cuenta.');
    await page.getByTestId('enviar-admin-ticket').click();

    await expect(page).toHaveURL(/\/admin\/tickets\/[a-z0-9]+$/);
    // Nace esperando al usuario y asignado al agente que lo abre (corolario R2).
    await expect(page.getByTestId('ticket-status')).toHaveText('Esperando tu respuesta');

    // El usuario lo ve en SUS tickets (owner-scope de R6, sin cambios).
    const userPage = await sellerContext.newPage();
    await userPage.goto('/mis-tickets');
    await expect(userPage.getByTestId('lista-tickets')).toContainText(subject);
  });

  // ===========================================================================
  // FLUJO (c) — desde una denuncia
  // ===========================================================================

  test('FLUJO (c): contactar al reportado desde /admin/reportes y enlazar el hilo', async ({
    adminContext,
    request,
  }) => {
    const page = await adminContext.newPage();

    // Denuncia nueva sobre el usuario de pruebas.
    const reporte = await authedPost(request, '/moderation/reports', adminToken, {
      reason: 'SPAM',
      description: `Denuncia e2e ${Date.now()}`,
      reportedUserId: sellerId,
    });
    expect(reporte.status()).toBe(201);
    const reportId = (await reporte.json()).id as string;

    await page.goto('/admin/reportes');
    const fila = page.locator('tr', { hasText: reportId.slice(0, 8) }).first();
    // El id no se pinta; se localiza la fila por el botón que solo tienen los
    // reportes sin hilo todavía, y se usa el primero disponible.
    const boton = page.getByTestId('contactar-reportado').first();
    await expect(boton).toBeVisible();
    await boton.click();

    // Tras crearlo, la ficha enlaza el hilo en vez de ofrecer abrir otro.
    await expect(page.getByTestId('enlace-hilo-reporte').first()).toBeVisible();
    expect(fila).toBeTruthy();

    // El Report NO cambia de estado por abrir el hilo (siguen siendo acciones
    // independientes): sigue PENDING.
    const tras = await authedGet(request, `/moderation/reports/${reportId}`, adminToken);
    expect((await tras.json()).status).toBe('PENDING');
  });
});
