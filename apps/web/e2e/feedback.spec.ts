// UXV.3 — FEEDBACK: la infraestructura de notificación y los tres feedbacks que la
// consumen.
//
// Lo que fija esta batería es que ninguna acción de la zona termine en silencio (M6/M5),
// que ninguna acción irreversible se ejecute sin confirmar (M7), y que quien sale a
// comprar créditos pueda volver a lo que iba a hacer (A7-flujo).

import { test, expect } from './fixtures/auth';

/**
 * Sonner monta DOS cosas distintas y conviene no confundirlas:
 *  - una `<section>` de región accesible que existe SIEMPRE, esté o no avisando: es lo
 *    que prueba que el `<Toaster/>` del layout raíz está puesto;
 *  - el `ol[data-sonner-toaster]`, que solo aparece cuando hay un aviso vivo: es donde
 *    se lee el texto.
 */
const toasterMontado = (page: import('@playwright/test').Page) =>
  page.locator('section[aria-label*="Notifications"]');
const toast = (page: import('@playwright/test').Page) =>
  page.locator('[data-sonner-toaster]');

test.describe('UXV.3 (M6) — hay un canal de notificación, y es global', () => {
  test('el Toaster está montado en la zona de cuenta, en la pública y en el backoffice', async ({
    sellerContext,
    adminContext,
  }) => {
    const page = await sellerContext.newPage();

    for (const ruta of ['/mis-anuncios', '/', '/mis-creditos']) {
      await page.goto(ruta, { waitUntil: 'domcontentloaded' });
      await expect(toasterMontado(page), `sin Toaster en ${ruta}`).toBeAttached({ timeout: 15_000 });
    }

    // Y también donde no hay sesión de vendedor: va FUERA del provider de auth.
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(toasterMontado(adminPage)).toBeAttached({ timeout: 15_000 });
  });
});

test.describe('UXV.3 (M5) — destacar deja de completarse en silencio', () => {
  test('destacar con créditos confirma con un toast que dice duración y coste', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // Saldo suficiente y destacado aceptado: lo que se mide aquí es el AVISO, no el cobro
    // (que ya tiene su cobertura en billing-rf6.e2e-spec.ts).
    await page.route('**/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ balance: 500, bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      }),
    );
    await page.route('**/billing/featured-by-credits', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );

    await page.goto('/mis-anuncios');
    await page.getByTestId('btn-destacar').first().click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /destacar con créditos/i }).click();

    // ANTES: el diálogo se cerraba y no se decía absolutamente nada, mientras el bump —en
    // la misma tarjeta— sí confirmaba. Ahora las dos operaciones gemelas avisan igual.
    await expect(toast(page)).toContainText(/anuncio destacado/i, { timeout: 15_000 });
    await expect(toast(page)).toContainText(/créditos/i);
  });

  test('el bump también avisa por el canal común, no con su <p> verde propio', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.route('**/listings/*/bump', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpedAt: new Date().toISOString(), paidWith: 'CREDITS', cost: 5 }),
      }),
    );

    await page.goto('/mis-anuncios');
    await page.getByTestId('btn-bump').first().click();

    await expect(toast(page)).toContainText(/bump aplicado/i, { timeout: 15_000 });
    await expect(toast(page)).toContainText(/5 créditos/i);
    // El aviso inline que tenía antes ya no existe: si sobreviviera, habría dos sitios
    // donde mirar y volveríamos a la incoherencia que M5 denuncia.
    await expect(page.getByTestId('bump-confirmation')).toHaveCount(0);
  });

  test('el error del bump SIGUE inline: lleva enganchada la acción de recuperación', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.route('**/listings/*/bump', (route) =>
      route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 402, message: 'Insufficient credits' }),
      }),
    );

    await page.goto('/mis-anuncios');
    await page.getByTestId('btn-bump').first().click();

    // Regla de reparto FEEDBACK-D2: el error con contexto no se va al toast.
    await expect(page.getByText(/no tienes créditos suficientes/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /comprar créditos/i })).toBeVisible();
  });
});

test.describe('UXV.3 (A7-flujo) — quien sale a comprar puede volver a lo que iba a hacer', () => {
  test('el enlace de "comprar créditos" lleva la intención en la URL', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.route('**/listings/*/bump', (route) =>
      route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 402, message: 'Insufficient credits' }),
      }),
    );

    await page.goto('/mis-anuncios');
    await page.getByTestId('btn-bump').first().click();

    const enlace = page.getByRole('link', { name: /comprar créditos/i });
    await expect(enlace).toBeVisible({ timeout: 15_000 });
    // El destino es la ficha del anuncio (donde se remata la acción), no el listado.
    await expect(enlace).toHaveAttribute('href', /\/mis-creditos\?volver=%2Fanuncio%2F/);
  });

  test('la página de éxito ofrece VOLVER A TERMINAR cuando trae intención', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.route('**/billing/bump-ledger**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      }),
    );
    await page.route('**/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balance: 150,
          bumpBalance: 0,
          items: [
            {
              id: 'l1',
              walletId: 'w1',
              type: 'PACK_PURCHASE',
              amount: 150,
              referenceId: null,
              referenceType: null,
              note: null,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        }),
      }),
    );

    await page.goto('/mis-creditos/exito?volver=%2Fanuncio%2Fmi-anuncio');

    await expect(page.getByTestId('compra-confirmada')).toBeVisible({ timeout: 20_000 });
    const volver = page.getByTestId('volver-a-la-accion');
    await expect(volver).toBeVisible();
    await expect(volver).toHaveAttribute('href', '/anuncio/mi-anuncio');
  });

  test('sin intención, las salidas son las genéricas — no se inventa un destino', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.route('**/billing/bump-ledger**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      }),
    );
    await page.route('**/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balance: 150,
          bumpBalance: 0,
          items: [
            {
              id: 'l1',
              walletId: 'w1',
              type: 'PACK_PURCHASE',
              amount: 150,
              referenceId: null,
              referenceType: null,
              note: null,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        }),
      }),
    );

    await page.goto('/mis-creditos/exito');

    await expect(page.getByTestId('compra-confirmada')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('volver-a-la-accion')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /ver mi saldo/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /ir a mis anuncios/i })).toBeVisible();
  });

  test('un destino manipulado en la URL NO se convierte en enlace', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.route('**/billing/bump-ledger**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      }),
    );
    await page.route('**/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balance: 150,
          bumpBalance: 0,
          items: [
            {
              id: 'l1',
              walletId: 'w1',
              type: 'PACK_PURCHASE',
              amount: 150,
              referenceId: null,
              referenceType: null,
              note: null,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        }),
      }),
    );

    // El backend ya filtra al construir la URL de vuelta; esta es la segunda cerradura,
    // por si alguien llega a esta página con la URL escrita a mano.
    await page.goto('/mis-creditos/exito?volver=' + encodeURIComponent('//evil.com'));

    await expect(page.getByTestId('compra-confirmada')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('volver-a-la-accion')).toHaveCount(0);
  });
});

test.describe('UXV.3 (M7) — la factura se confirma antes y se anuncia después', () => {
  test('«Solicitar factura» abre confirmación y NO emite hasta aceptarla', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    let emitida = false;
    await page.route('**/billing/facturas', async (route) => {
      emitida = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'inv-1' }) });
    });

    await page.goto('/perfil/facturacion');
    const boton = page.getByRole('button', { name: 'Solicitar factura' });
    await expect(boton).toBeEnabled({ timeout: 20_000 });
    await boton.click();

    // ANTES: un clic y ya estaba emitido un documento fiscal INMUTABLE, sin preguntar —
    // mientras archivar un anuncio sí preguntaba.
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(/no se puede modificar ni anular/i);
    expect(emitida).toBe(false);

    // Cancelar no emite.
    await dialogo.getByRole('button', { name: /cancelar/i }).click();
    await expect(dialogo).not.toBeVisible();
    expect(emitida).toBe(false);

    // Confirmar sí emite, y lo dice.
    await boton.click();
    await page.getByRole('alertdialog').getByRole('button', { name: /emitir factura/i }).click();
    await expect.poll(() => emitida, { timeout: 15_000 }).toBe(true);
    await expect(toast(page)).toContainText(/factura emitida/i, { timeout: 15_000 });
  });
});
