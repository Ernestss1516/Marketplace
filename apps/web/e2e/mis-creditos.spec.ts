// RF.10 — Playwright E2E for /mis-creditos (wallet) and /mis-creditos/exito|error.
//
// Arquitectura de las pruebas:
//   - /mis-creditos es un Server Component: sus llamadas API (getWallet, getCatalog)
//     van de Next.js server a NestJS, NO pasan por el browser. page.route NO las
//     intercepta. Estas pruebas usan los datos REALES del backend (sin mocks SSR).
//   - /mis-creditos/exito es un Client Component ('use client'): su llamada a
//     getWallet() sí va por el browser → page.route la intercepta correctamente.
//   - POST /billing/checkout/credits-pack se llama desde PackList.tsx (client)
//     → page.route lo intercepta.
//
// Lo NO verificable sin credenciales Redsys reales:
//   - El submit real del form al TPV de Redsys
//   - La notificación online (POST /webhooks/redsys)
//   - La acreditación de créditos en el wallet
//
// Prerequisite: global-setup.ts must have created storageState for sellerContext.

import { test, expect } from './fixtures/auth';

const MOCK_WALLET_EMPTY = {
  balance: 0,
  items: [],
  total: 0,
  page: 1,
  perPage: 20,
  totalPages: 0,
};

const MOCK_WALLET_WITH_BALANCE = {
  balance: 150,
  items: [
    {
      id: 'ledger-1',
      walletId: 'wallet-1',
      type: 'PACK_PURCHASE',
      amount: 150,
      referenceId: 'tx-1',
      referenceType: 'Transaction',
      note: null,
      createdAt: new Date().toISOString(),
    },
  ],
  total: 1,
  page: 1,
  perPage: 20,
  totalPages: 1,
};

const MOCK_REDSYS_FORM = {
  redsysFormData: {
    Ds_MerchantParameters: 'bW9jaw==',
    Ds_SignatureVersion: 'HMAC_SHA256_V1',
    Ds_Signature: 'mocksignature123',
    tpvUrl: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  },
};

test.describe('/mis-creditos — protección de ruta', () => {
  test('redirige a /login sin sesión', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/mis-creditos');
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toContain('/login');

    await ctx.close();
  });
});

test.describe('/mis-creditos — con sesión (sellerContext)', () => {
  // NOTA: /mis-creditos es Server Component. Los datos (wallet, catálogo) se
  // obtienen en el servidor. Las pruebas usan datos reales del backend seeded.
  // seller-e2e@example.com no tiene wallet → balance 0, historial vacío.

  test('renderiza la página con saldo 0 e historial vacío (datos reales del backend)', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-creditos');

    // El <h1> de la página es "Mi saldo", NO "Mis créditos". Ojo: "Mis créditos"
    // sí existe, pero como etiqueta del NAV de la cuenta ((account)/layout.tsx),
    // no como título de la página. El test se escribió contra el rótulo del menú.
    // Ver docs/ci-playwright-plan.md §3: el desajuste nav ↔ página está reportado
    // como decisión de producto pendiente; aquí el test afirma lo que la página
    // MUESTRA hoy, que es lo que le toca.
    await expect(page.getByRole('heading', { name: 'Mi saldo' })).toBeVisible({ timeout: 10_000 });

    // MIS-CRÉDITOS RÁFAGA B — LA FRANJA DE SALDO, que es lo PRIMERO de la página.
    //
    // Antes esto buscaba el rótulo «Saldo disponible» de una tarjeta que vivía dentro de la
    // sección «Créditos», por debajo del formulario de canjear cupón. La reorganización por
    // tarea subió las dos monedas —y la cuota Pro— a una franja arriba del todo, así que ese
    // rótulo ya no existe. Lo que el caso afirma no cambia: que el saldo se ve. Cambia dónde.
    const resumen = page.getByTestId('resumen-saldo');
    await expect(resumen).toBeVisible();
    // seller-e2e no tiene wallet, así que su saldo real es 0 en las dos monedas.
    await expect(page.getByTestId('saldo-creditos')).toHaveText('0');
    await expect(page.getByTestId('saldo-bumps')).toHaveText('0');

    // BARRERA 5 — el saldo con SENTIDO: en qué se traduce, con el coste de cada acción.
    // El número desnudo era exactamente el defecto (§4.2): la página que responde «cuánto
    // tengo» no respondía «para cuánto me da».
    await expect(page.getByTestId('saldo-equivalencias')).toContainText('bump');

    // BARRERA 6 — seller-e2e NO es Pro: la tarjeta de plan no está, y no queda hueco roto.
    await expect(page.getByTestId('resumen-pro')).toHaveCount(0);

    // UXV.6 (B5) — el vacío ya no solo constata: dice QUÉ son los créditos y ofrece la
    // salida para conseguirlos. Lo que se afirma sigue siendo «el historial está vacío».
    await expect(page.getByText(/todavía no tienes movimientos de créditos/i)).toBeVisible();
  });

  test('muestra packs del catálogo con créditos y precio (datos reales del seed)', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-creditos');

    // Catalog packs are seeded in seed-test.ts (Pack Básico, Estándar, Max)
    await expect(page.getByText('Pack Básico')).toBeVisible({ timeout: 10_000 });

    // Acotado al ENCABEZADO: desde UXV.6 el estado vacío del historial lleva un enlace con
    // ese mismo rótulo, así que un getByText suelto casa con dos.
    await expect(page.getByRole('heading', { name: 'Comprar créditos' })).toBeVisible();

    // At least one "Comprar" button
    await expect(page.getByRole('button', { name: 'Comprar' }).first()).toBeVisible();

    // Price in euros
    await expect(page.getByText('€', { exact: false }).first()).toBeVisible();
  });

  /**
   * MIS-CRÉDITOS RÁFAGA B (barreras 1 y 2) — EL ORDEN DE LA PÁGINA.
   *
   * Se comprueba AQUÍ y no en un test de componente porque lo que se afirma es el orden
   * real del documento, y eso sólo existe cuando la página entera se ha renderizado. Un
   * unitario puede probar que la franja pinta lo que debe; sólo esto puede probar que va
   * ANTES que el cupón.
   */
  test('BARRERA 1 — el saldo va antes que el cupón, que era quien le ocupaba el sitio', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');

    await expect(page.getByTestId('resumen-saldo')).toBeVisible({ timeout: 10_000 });
    const cupon = page.getByTestId('coupon-code-input');
    await expect(cupon).toBeVisible();

    // DOCUMENT_POSITION_FOLLOWING (4): el cupón viene DESPUÉS de la franja. Antes de esta
    // ráfaga esta comprobación habría salido al revés — el formulario de cupón era lo
    // primero tras el título, y para ver el saldo había que bajar.
    const saldoVaPrimero = await page.evaluate(() => {
      const franja = document.querySelector('[data-testid="resumen-saldo"]');
      const input = document.querySelector('[data-testid="coupon-code-input"]');
      if (!franja || !input) return null;
      return (franja.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(saldoVaPrimero).toBe(true);

    // BARRERA 6 — y el cupón sigue funcionando desde su nueva posición: entero, con su
    // botón. Bajarlo no era esconderlo.
    await expect(page.getByRole('button', { name: 'Canjear' })).toBeVisible();
  });

  test('BARRERA 2 — las secciones agrupan por TAREA, no por moneda', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');

    await expect(page.getByTestId('resumen-saldo')).toBeVisible({ timeout: 10_000 });

    // La página eran dos bloques simétricos por MONEDA («Créditos» y «Bumps»), cada uno con
    // saldo + compra + historial: había que atravesar el historial de créditos entero para
    // llegar al saldo de bumps. Ahora los encabezados de sección nombran lo que el usuario
    // HACE, en el orden en que lo hace.
    const secciones = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(secciones).toEqual(['Conseguir más saldo', 'Gestionar', 'Historial']);
  });

  // UXV.2 — el menú de la cuenta rotula esta entrada «Mi saldo», no «Mis créditos»
  // (SHELL-D4): es el mismo rótulo que el <h1> y el <title> de la propia página, así que
  // el desajuste nav ↔ página que anotaba el comentario de arriba ya no existe (queda
  // solo la URL histórica /mis-creditos, que es lo que cierra B1 en UXV.6).
  // Lo que la prueba afirma no cambia: que la cartera es alcanzable desde el menú.
  test('el menú de la cuenta lleva a la cartera («Mi saldo»)', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-creditos');

    const menu = page.getByRole('navigation', { name: /secciones de mi cuenta/i });
    const entrada = menu.getByRole('link', { name: 'Mi saldo', exact: true });
    await expect(entrada).toBeVisible({ timeout: 10_000 });
    await expect(entrada).toHaveAttribute('href', '/mis-creditos');
  });

  // PackList.tsx es un Client Component → page.route intercepta POST /billing/checkout/credits-pack
  test('click "Comprar" → llama al backend → monta form POST con los 4 campos Redsys', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // Override HTMLFormElement.prototype.submit BEFORE React loads so the form
    // auto-submit is intercepted. The form stays in the DOM and we can assert on it.
    await page.addInitScript(() => {
      HTMLFormElement.prototype.submit = function () {
        // no-op: prevent navigation, keep form in DOM
      };
    });

    // Mock the checkout endpoint (client-side call from PackList.tsx)
    let checkoutCalled = false;
    await page.route('**/billing/checkout/credits-pack', async (route) => {
      checkoutCalled = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REDSYS_FORM),
      });
    });

    await page.goto('/mis-creditos');
    await expect(page.getByRole('button', { name: 'Comprar' }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Comprar' }).first().click();

    // The checkout endpoint must have been called (client-side, intercepted by page.route)
    await expect
      .poll(() => checkoutCalled, { timeout: 5_000 })
      .toBe(true);

    // The RedsysRedirectForm should be mounted with the correct attributes
    // (form.submit() was overridden so the form stays in DOM)
    const form = page.locator('[data-testid="redsys-redirect-form"]');
    await expect(form).toBeAttached({ timeout: 5_000 });
    await expect(form).toHaveAttribute('method', 'POST');
    await expect(form).toHaveAttribute('action', MOCK_REDSYS_FORM.redsysFormData.tpvUrl);

    // All 3 hidden inputs with signed values
    await expect(
      form.locator('input[name="Ds_MerchantParameters"]'),
    ).toHaveValue(MOCK_REDSYS_FORM.redsysFormData.Ds_MerchantParameters);

    await expect(
      form.locator('input[name="Ds_SignatureVersion"]'),
    ).toHaveValue(MOCK_REDSYS_FORM.redsysFormData.Ds_SignatureVersion);

    await expect(
      form.locator('input[name="Ds_Signature"]'),
    ).toHaveValue(MOCK_REDSYS_FORM.redsysFormData.Ds_Signature);
  });

  test('backend 401 en checkout → sesión expirada → redirige a /login', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.route('**/billing/checkout/credits-pack', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
      });
    });

    // Prevent actual signOut from invalidating the storageState
    await page.route('**/api/auth/signout**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/mis-creditos');
    await expect(page.getByRole('button', { name: 'Comprar' }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Comprar' }).first().click();

    // useApiAction handles 401 with signOut + redirect
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('/login');

    // Raw error message must never reach the UI
    await expect(page.getByText('Unauthorized')).not.toBeVisible();
  });
});

test.describe('/mis-creditos/exito', () => {
  // /mis-creditos/exito ES un Client Component → page.route intercepta getWallet()
  //
  // UXV.1 (A7) — esta página tenía un spinner que NO terminaba nunca: no había estado
  // terminal, así que el usuario tenía que pulsar "Actualizar saldo" a mano y comparar
  // cifras para saber si su compra había entrado. Las pruebas de antes fijaban ese
  // comportamiento (botón manual + enlace de texto); ahora fijan el arreglo: la página
  // sondea sola y RESUELVE.

  /** El historial de bumps se consulta junto al wallet — se fija vacío para que la
   *  condición terminal dependa solo de lo que cada prueba quiere probar. */
  async function stubBumpLedger(page: import('@playwright/test').Page) {
    await page.route('**/billing/bump-ledger**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      });
    });
  }

  test('resuelve a confirmado en cuanto el webhook ha acreditado — sin pulsar nada', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await stubBumpLedger(page);

    // Compra ya acreditada: hay un PACK_PURCHASE reciente en el historial.
    await page.route('**/billing/wallet**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WALLET_WITH_BALANCE),
      });
    });

    await page.goto('/mis-creditos/exito');

    // Estado TERMINAL, sin intervención del usuario.
    await expect(page.getByTestId('compra-confirmada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /saldo añadido/i })).toBeVisible();
    await expect(page.getByText('150 créditos', { exact: false })).toBeVisible();

    // Salidas de verdad (botones), no un enlace de texto suelto.
    await expect(page.getByRole('link', { name: /ver mi saldo/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /ir a mis anuncios/i })).toBeVisible();

    // Y el spinner ya no está.
    await expect(page.getByText(/estamos confirmando tu pago/i)).not.toBeVisible();
  });

  test('mientras el webhook no llega, sondea sola y NO afirma que el saldo esté acreditado', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await stubBumpLedger(page);

    let callCount = 0;
    await page.route('**/billing/wallet**', async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WALLET_EMPTY),
      });
    });

    await page.goto('/mis-creditos/exito');

    await expect(
      page.getByRole('heading', { name: /gracias por tu compra/i }),
    ).toBeVisible({ timeout: 10_000 });
    // No se anuncia un éxito que no ha ocurrido.
    await expect(page.getByTestId('compra-confirmada')).not.toBeVisible();

    // EL ARREGLO: vuelve a preguntar por su cuenta. Antes esto solo pasaba al pulsar
    // "Actualizar saldo", y sin pulsarlo el spinner giraba indefinidamente.
    const callsBefore = callCount;
    await expect.poll(() => callCount, { timeout: 15_000 }).toBeGreaterThan(callsBefore);

    await expect(page.getByText(/error/i)).not.toBeVisible();
  });
});

test.describe('/mis-creditos/error', () => {
  // Protected route — needs a session
  test('muestra mensaje de error y enlace a /mis-creditos', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-creditos/error');

    await expect(
      page.getByRole('heading', { name: /el pago no se completó/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/no se te ha cobrado/i)).toBeVisible();

    const link = page.getByRole('link', { name: /volver a mis créditos/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/mis-creditos');
  });
});
