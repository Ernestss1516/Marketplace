// RF.11 — Playwright E2E: destacado + bump (créditos y Redsys).
//
// Arquitectura:
//   /mis-anuncios es Server Component. Los datos de listing (bumpedAt, featuredUntil)
//   llegan via SSR y NO se pueden interceptar con page.route.
//
//   Los datos de sesión (slug del vendedor) llegan via el JWT almacenado en
//   storageState (sin interceptor necesario).
//
//   Las llamadas client-side (DestacadoDialog: getCatalog, getWallet,
//   featuredByCredits, createFeaturedCheckout; bumpListing) SÍ se pueden
//   interceptar con page.route.
//
// Prerequisito: global-setup.ts debe haber creado el listing "listing-rf11-e2e"
// (ACTIVE, sellerId = seller-e2e@example.com) via seed-playwright.ts.
//
// Lo NO verificable sin Redsys real:
//   - El submit real al TPV de Redsys
//   - La notificación online POST /webhooks/redsys
//   - La concesión del entitlement FEATURED_LISTING

import { test, expect } from './fixtures/auth';
import { abrirDestacar, subirDesdeDialogo } from './helpers/promocion';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_FEATURED_PRICE_7D_ID = 'price-featured-7d-mock';

const MOCK_CATALOG = {
  products: [
    {
      id: 'prod-featured',
      name: 'Destacado',
      description: null,
      type: 'ONE_TIME',
      prices: [
        {
          priceId: MOCK_FEATURED_PRICE_7D_ID,
          amount: 2.99,
          currency: 'EUR',
          durationDays: 7,
          creditCost: 30,
        },
        {
          priceId: 'price-featured-14d-mock',
          amount: 4.99,
          currency: 'EUR',
          durationDays: 14,
          creditCost: 50,
        },
      ],
    },
  ],
  bumpCreditCost: 5,
};

const MOCK_WALLET_ENOUGH = {
  balance: 60,
  items: [],
  total: 0,
  page: 1,
  perPage: 20,
  totalPages: 0,
};

const MOCK_WALLET_EMPTY = {
  balance: 5,
  items: [],
  total: 0,
  page: 1,
  perPage: 20,
  totalPages: 0,
};

const MOCK_REDSYS_FORM = {
  redsysFormData: {
    Ds_MerchantParameters: 'bW9jaw==',
    Ds_SignatureVersion: 'HMAC_SHA256_V1',
    Ds_Signature: 'mocksignature123456789012345678901234567=',
    tpvUrl: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  },
};

const LISTING_SLUG = 'listing-rf11-e2e';
const SELLER_SLUG = 'vendedor-e2e';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function mockCatalogAndWallet(
  page: import('@playwright/test').Page,
  wallet: object,
) {
  await page.route('**/billing/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CATALOG),
    });
  });
  await page.route('**/billing/wallet**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(wallet),
    });
  });
}

// ── DestacadoDialog — desde /mis-anuncios ──────────────────────────────────────

test.describe('DestacadoDialog — desde /mis-anuncios', () => {
  test('abre el dialog al clicar "Destacar" y muestra opciones de duración y pago', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await mockCatalogAndWallet(page, MOCK_WALLET_ENOUGH);

    await page.goto('/mis-anuncios');
    // UXV.4 — el punto de entrada es «Promocionar»; «Destacar» es un producto dentro.
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 10_000 });
    await abrirDestacar(page);

    await expect(page.getByRole('dialog').getByText('Promocionar anuncio')).toBeVisible();

    // Duration options (mocked catalog has 7d and 14d)
    await expect(page.getByText('7 días')).toBeVisible();
    await expect(page.getByText('14 días')).toBeVisible();

    // Payment method options
    // UXV.4 — acotado al método de PAGO: en el diálogo nuevo el producto «Subir al inicio»
    // también menciona créditos (su coste), así que un getByLabel('Créditos') casaría con dos.
    await expect(page.locator('label[for="pay-credits"]')).toBeVisible();
    await expect(page.getByLabel('Tarjeta bancaria')).toBeVisible();

    // Credit cost shown (30 cr for 7d)
    await expect(page.getByText('30 cr.', { exact: false })).toBeVisible();
  });

  test('destacar con créditos suficientes → llama featuredByCredits → éxito', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await mockCatalogAndWallet(page, MOCK_WALLET_ENOUGH); // 60 >= 30 (7d creditCost)

    let featuredCalled = false;
    await page.route('**/billing/featured-by-credits', async (route) => {
      featuredCalled = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Credits method is pre-selected — click submit
    const submitBtn = page.getByRole('button', { name: /destacar con créditos/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await expect.poll(() => featuredCalled, { timeout: 5_000 }).toBe(true);

    // Dialog closes on success
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
  });

  test('saldo insuficiente → botón deshabilitado, mensaje de "Comprar créditos"', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    // MOCK_WALLET_EMPTY has balance=5, creditCost for 7d is 30 → insufficient
    await mockCatalogAndWallet(page, MOCK_WALLET_EMPTY);

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Submit button disabled for credits path
    const submitBtn = page.getByRole('button', { name: /destacar con créditos/i });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // "Comprar créditos" link shown
    await expect(page.getByRole('link', { name: /comprar créditos/i })).toBeVisible();
  });

  test('destacar con tarjeta → llama checkout → monta RedsysRedirectForm', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await mockCatalogAndWallet(page, MOCK_WALLET_EMPTY);

    // Override form.submit() so we can assert on the DOM
    await page.addInitScript(() => {
      HTMLFormElement.prototype.submit = function () { /* noop */ };
    });

    let checkoutCalled = false;
    await page.route('**/billing/checkout/featured-pay', async (route) => {
      checkoutCalled = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REDSYS_FORM),
      });
    });

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Select "Tarjeta bancaria" payment method
    await page.getByLabel('Tarjeta bancaria').click();

    const payBtn = page.getByRole('button', { name: /pagar con tarjeta/i });
    await expect(payBtn).toBeEnabled({ timeout: 3_000 });
    await payBtn.click();

    await expect.poll(() => checkoutCalled, { timeout: 5_000 }).toBe(true);

    // RedsysRedirectForm mounts with correct TPV url
    const form = page.locator('[data-testid="redsys-redirect-form"]');
    await expect(form).toBeAttached({ timeout: 5_000 });
    await expect(form).toHaveAttribute('method', 'POST');
    await expect(form).toHaveAttribute('action', MOCK_REDSYS_FORM.redsysFormData.tpvUrl);
  });
});

// ── Bump — desde /mis-anuncios ─────────────────────────────────────────────────

test.describe('Bump — desde /mis-anuncios', () => {
  test('clicar "Bump" llama POST /listings/:id/bump', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    let bumpCalled = false;
    await page.route('**/listings/*/bump', async (route) => {
      bumpCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/mis-anuncios');
    // UXV.4 — el vendedor de la semilla no tiene cuota ni saldo, así que subir CUESTA y el
    // control primario abre el diálogo en vez de ejecutar (el atajo de un clic es solo
    // para el bump gratis). El anuncio está recién sembrado: sin cooldown.
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 10_000 });
    await subirDesdeDialogo(page);

    await expect.poll(() => bumpCalled, { timeout: 5_000 }).toBe(true);
  });

  test('bump con 402 (saldo insuficiente) → mensaje "No tienes créditos" + link a mis-creditos', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.route('**/listings/*/bump', async (route) => {
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 402, message: 'Insufficient credits' }),
      });
    });

    await page.goto('/mis-anuncios');
    await subirDesdeDialogo(page);

    // Must NOT show generic error
    await expect(page.getByText('Ha ocurrido un error')).not.toBeVisible({ timeout: 3_000 });

    // Must show domain-specific credit error
    await expect(
      page.getByText(/no tienes créditos suficientes/i),
    ).toBeVisible({ timeout: 5_000 });

    // Must include a link to /mis-creditos
    await expect(
      page.getByRole('link', { name: /comprar créditos/i }),
    ).toBeVisible();
  });

  test('bump con 429 (cooldown) → muestra mensaje de cooldown con retryAfter, no el genérico', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // retryAfter: 3300 s = 55 minutos (valor realista dentro del cooldown de 1h)
    await page.route('**/listings/*/bump', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too soon', retryAfter: 3300 }),
      });
    });

    await page.goto('/mis-anuncios');
    await subirDesdeDialogo(page);

    // Must NOT show generic error
    await expect(page.getByText(/ha ocurrido un error/i)).not.toBeVisible({ timeout: 3_000 });

    // Must NOT leak internal backend message
    await expect(page.getByText('Too soon')).not.toBeVisible();

    // Must show domain-specific cooldown message
    await expect(
      page.getByText(/ya has subido este anuncio/i),
    ).toBeVisible({ timeout: 5_000 });

    // Must show the computed wait time (3300 s → 55 minutos)
    await expect(page.getByText(/55 minutos/i)).toBeVisible();
  });
});

// ── Páginas de retorno /mis-anuncios/destacado-* ───────────────────────────────

test.describe('Páginas de retorno /mis-anuncios/destacado-*', () => {
  test('destacado-exito muestra "Pago recibido" y enlace a mis-anuncios', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-anuncios/destacado-exito');

    await expect(
      page.getByRole('heading', { name: /pago recibido/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole('link', { name: /ver mis anuncios/i }),
    ).toBeVisible();
  });

  test('destacado-error muestra "pago no se completó" y enlace de regreso', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto('/mis-anuncios/destacado-error');

    await expect(
      page.getByRole('heading', { name: /pago no se completó/i }),
    ).toBeVisible({ timeout: 10_000 });

    const backLink = page.getByRole('link', { name: /volver a mis anuncios/i });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/mis-anuncios');
  });
});

// ── ListingOwnerActions — desde /anuncio/[slug] ────────────────────────────────

test.describe('ListingOwnerActions — ficha del anuncio', () => {
  test('el propietario ve los botones "Destacar anuncio" y "Subir al inicio"', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    await page.goto(`/anuncio/${LISTING_SLUG}`);

    // UXV.4 — la ficha y la tarjeta comparten ya el MISMO control: un solo «Promocionar»
    // que agrupa subir y destacar, con el mismo coste y el mismo cooldown. Antes eran dos
    // botones cuyos rótulos ni siquiera coincidían con los de la tarjeta.
    await expect(page.getByTestId('btn-promocionar')).toBeVisible({ timeout: 10_000 });
  });

  test('el comprador NO ve los botones de owner (slug diferente)', async ({
    buyerContext,
  }) => {
    const page = await buyerContext.newPage();

    await page.goto(`/anuncio/${LISTING_SLUG}`);

    // ContactButton should be visible (public users see this)
    await expect(
      page.getByRole('button', { name: /contactar/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Owner actions must not be visible
    await expect(page.getByTestId('btn-promocionar')).not.toBeVisible();
  });

  test('usuario no autenticado NO ve los botones de owner', async ({ browser }) => {
    const ctx = await browser.newContext(); // no storageState → unauthenticated
    const page = await ctx.newPage();

    await page.goto(`/anuncio/${LISTING_SLUG}`);

    await expect(
      page.getByRole('button', { name: /contactar/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('btn-promocionar')).not.toBeVisible();

    await ctx.close();
  });

  test('el propietario puede abrir DestacadoDialog desde la ficha', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await mockCatalogAndWallet(page, MOCK_WALLET_ENOUGH);

    await page.goto(`/anuncio/${LISTING_SLUG}`);

    // UXV.4 — desde la ficha se abre el MISMO diálogo que desde la tarjeta, con los mismos
    // productos: es la reconciliación de las dos superficies.
    await expect(page.getByTestId('btn-promocionar')).toBeVisible({ timeout: 10_000 });
    await abrirDestacar(page);

    await expect(page.getByRole('dialog').getByText('Promocionar anuncio')).toBeVisible();

    await expect(page.getByText('7 días')).toBeVisible();
  });
});
