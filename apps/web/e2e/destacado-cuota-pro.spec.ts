// H8.5b — Playwright E2E: selector de vía al destacar (cuota Pro vs. créditos/tarjeta) +
// visibilidad de la cuota en /mis-anuncios y /perfil/suscripcion.
//
// El listing "listing-pro-e2e" (seed-playwright.ts) pertenece a pro-e2e@example.com,
// que tiene una Subscription + Entitlement PRO_SUBSCRIPTION activos (seed-playwright.ts).
//
// Todas las pruebas que ABREN/ENVÍAN el dialog mockean `**/billing/pro-status` y
// `**/billing/featured-by-credits` — nunca consumen la cuota real de pro-e2e, así el
// estado real de ese usuario (usado en los tests de /perfil/suscripcion y /mis-anuncios,
// que son Server Components y no se pueden interceptar) se mantiene intacto entre runs.

import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';
import { abrirDestacar } from './helpers/promocion';

const MOCK_CATALOG = {
  products: [
    {
      id: 'prod-featured',
      name: 'Destacado',
      description: null,
      type: 'ONE_TIME',
      prices: [
        { priceId: 'price-7d-mock', amount: 2.99, currency: 'EUR', durationDays: 7, creditCost: 30 },
        { priceId: 'price-14d-mock', amount: 4.99, currency: 'EUR', durationDays: 14, creditCost: 50 },
        { priceId: 'price-30d-mock', amount: 7.99, currency: 'EUR', durationDays: 30, creditCost: 100 },
      ],
    },
  ],
  bumpCreditCost: 5,
};

const MOCK_WALLET = { balance: 60, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 };

function mockProStatus(page: Page, status: object) {
  return page.route('**/billing/pro-status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
  });
}

async function mockCatalogWalletAndStatus(page: Page, proStatus: object) {
  await page.route('**/billing/catalog', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CATALOG) });
  });
  await page.route('**/billing/wallet**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_WALLET) });
  });
  await mockProStatus(page, proStatus);
}

const PRO_STATUS_WITH_QUOTA = {
  isPro: true,
  limit: 4,
  used: 1,
  remaining: 3,
  periodStart: new Date().toISOString(),
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
  quotaDurationDays: 7,
};

const PRO_STATUS_LAST_ONE = { ...PRO_STATUS_WITH_QUOTA, used: 3, remaining: 1 };
const PRO_STATUS_EXHAUSTED = { ...PRO_STATUS_WITH_QUOTA, used: 4, remaining: 0 };

test.describe('DestacadoDialog — selector de vía (Pro con cuota disponible)', () => {
  test('Pro con cuota ve DOS opciones: "Destacar gratis" y "Destacar con créditos o tarjeta"', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_WITH_QUOTA);

    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 10_000 });
    await abrirDestacar(page);

    await expect(page.getByRole('dialog').getByText('Promocionar anuncio')).toBeVisible();

    // The "how to feature" selector with both products, clearly distinguished.
    await expect(page.getByText(/destacar gratis — 7 días/i)).toBeVisible();
    await expect(page.getByText(/te quedan 3 este mes/i)).toBeVisible();
    await expect(page.getByText(/destacar con créditos o tarjeta/i)).toBeVisible();
    await expect(page.getByText(/elige la duración: 7, 14 o 30 días/i)).toBeVisible();

    // Free option is the default — duration/payment radios are NOT shown yet.
    await expect(page.getByText('Duración', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Método de pago')).not.toBeVisible();

    // Submit button reflects the free path by default.
    await expect(page.getByRole('button', { name: /^destacar gratis$/i })).toBeVisible();
  });

  test('elegir "Destacar con créditos o tarjeta" revela duración y método de pago', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_WITH_QUOTA);

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByText(/destacar con créditos o tarjeta/i).click();

    await expect(page.getByText('Duración', { exact: true })).toBeVisible();
    await expect(page.getByText('Método de pago')).toBeVisible();
    await expect(page.getByText('7 días', { exact: true })).toBeVisible();
    await expect(page.getByText('14 días', { exact: true })).toBeVisible();
    await expect(page.getByText('30 días', { exact: true })).toBeVisible();
  });

  test('destacar gratis (cuota) → llama featuredByCredits con useQuota:true, sin priceId', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_WITH_QUOTA);

    let sentBody: Record<string, unknown> | null = null;
    await page.route('**/billing/featured-by-credits', async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ featuredUntil: new Date().toISOString(), viaQuota: true }),
      });
    });

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /^destacar gratis$/i }).click();

    await expect.poll(() => sentBody).not.toBeNull();
    expect((sentBody as unknown as { useQuota: boolean }).useQuota).toBe(true);
    expect((sentBody as unknown as { priceId?: string }).priceId).toBeUndefined();

    // Dialog closes on success — the boost itself takes a few seconds to show in
    // listings (async Meilisearch reindex), same as paid destacados.
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
  });

  test('remaining=1 → aviso "último destacado gratis de este mes"', async ({ proContext }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_LAST_ONE);

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText(/este es tu último destacado gratis de este mes/i)).toBeVisible();
  });

  test('elegir cuota pero el backend responde QUOTA_UNAVAILABLE → mensaje legible + ofrece créditos', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_WITH_QUOTA);

    await page.route('**/billing/featured-by-credits', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 400,
          message: 'No tienes cuota de destacados disponible este periodo',
          code: 'QUOTA_UNAVAILABLE',
        }),
      });
    });

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /^destacar gratis$/i }).click();

    // Readable, non-generic message.
    await expect(page.getByText(/ya no tienes cuota disponible este mes/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/ha ocurrido un error/i)).not.toBeVisible();

    // Gracefully offers the credits/card path instead of dead-ending.
    await expect(page.getByText('Duración', { exact: true })).toBeVisible();
    await expect(page.getByText('Método de pago')).toBeVisible();
  });

  test('cuota agotada (remaining=0) → NO se ofrece la opción gratis, solo créditos/tarjeta', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await mockCatalogWalletAndStatus(page, PRO_STATUS_EXHAUSTED);

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText(/destacar gratis/i)).not.toBeVisible();
    await expect(page.getByText('Duración', { exact: true })).toBeVisible();
    await expect(page.getByText('Método de pago')).toBeVisible();
  });
});

test.describe('DestacadoDialog — usuario no-Pro (sin cambios)', () => {
  test('no-Pro ve solo la vía de créditos/tarjeta — sin selector "Cómo destacar"', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.route('**/billing/catalog', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CATALOG) });
    });
    await page.route('**/billing/wallet**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_WALLET) });
    });
    // Real backend call for seller-e2e (not Pro) also returns isPro:false — mocking here
    // only to keep this test hermetic/fast regardless of backend timing.
    await mockProStatus(page, { isPro: false, limit: 0, used: 0, remaining: 0 });

    await page.goto('/mis-anuncios');
    await abrirDestacar(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText('Cómo destacar')).not.toBeVisible();
    await expect(page.getByText(/destacar gratis/i)).not.toBeVisible();
    await expect(page.getByText('Duración', { exact: true })).toBeVisible();
    await expect(page.getByText('Método de pago')).toBeVisible();
  });
});

test.describe('Visibilidad de la cuota Pro fuera del dialog', () => {
  test('/perfil/suscripcion muestra "Destacados gratis: N de LIMIT restantes" + fecha de renovación para Pro', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await page.goto('/perfil/suscripcion');

    await expect(page.getByText('Plan Pro', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/destacados gratis:/i)).toBeVisible();
    await expect(page.getByText(/\d+ de \d+ restantes este mes/i)).toBeVisible();
    await expect(page.getByText(/se renueva:/i)).toBeVisible();
  });

  test('/perfil/suscripcion NO muestra la sección de cuota para no-Pro', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/perfil/suscripcion');

    await expect(page.getByText('Plan Gratuito', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/destacados gratis:/i)).not.toBeVisible();
  });

  test('/mis-anuncios muestra el recordatorio de cuota para Pro con cuota disponible', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await page.goto('/mis-anuncios');

    await expect(page.getByTestId('quota-reminder')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('quota-reminder')).toContainText(/destacados? gratis este mes/i);
  });

  test('/mis-anuncios NO muestra el recordatorio de cuota para no-Pro', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('quota-reminder')).not.toBeVisible();
  });
});
