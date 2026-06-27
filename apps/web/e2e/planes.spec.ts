// RF.9 — Playwright E2E for /planes (pricing), checkout flow, and subscription management.
//
// Tests:
//   1. /planes renders without session — shows Free and Pro plans with backend-sourced prices
//   2. "Hazte Pro" without session → redirects to /login
//   3. "Hazte Pro" with session (sellerContext) → redirects to checkout.stripe.com
//   4. /planes/exito with session_id param → shows activating state (no error)
//   5. /planes/cancelado → shows cancellation message with link back to /planes
//   6. Pro user in /perfil/suscripcion → sees active plan + cancel dialog opens
//
// Prerequisites: global-setup.ts must have created storageState for seller-e2e and pro-e2e.
// pro-e2e@example.com must have an active PRO_SUBSCRIPTION entitlement (seeded by seed-playwright.ts).

import { test, expect } from './fixtures/auth';

test.describe('/planes — página de precios', () => {
  test('renderiza sin sesión y muestra planes Free y Pro', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/planes');

    // Page title
    await expect(page.getByRole('heading', { name: 'Elige tu plan' })).toBeVisible();

    // Free plan card
    await expect(page.getByRole('heading', { name: 'Gratis' })).toBeVisible();

    // At least one Pro plan card — prices come from the backend catalog
    await expect(page.getByRole('heading', { name: 'Pro' }).first()).toBeVisible();

    // "Hazte Pro" button exists (at least one)
    await expect(page.getByRole('button', { name: /Hazte Pro/i }).first()).toBeVisible();

    // Currency symbol shows up (prices are real, not hardcoded "por favor")
    await expect(page.getByText('€').first()).toBeVisible();

    await ctx.close();
  });

  test('"Hazte Pro" sin sesión redirige a /login', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/planes');
    await expect(page.getByRole('button', { name: /Hazte Pro/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /Hazte Pro/i }).first().click();

    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toContain('/login');

    await ctx.close();
  });
});

test.describe('/planes — sesión stale (JWT válido, usuario rechazado por el backend)', () => {
  test('backend devuelve 401 → signOut + redirige a /login, nunca muestra error crudo', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // Simulate a stale session: the JWT is valid (cookie exists) but the backend
    // rejects the request with 401 (e.g. user deleted from DB since login).
    await page.route('**/billing/checkout', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
      });
    });

    // Mock next-auth signOut so we don't actually invalidate the test session cookie
    await page.route('**/api/auth/signout**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/planes');
    await expect(page.getByRole('button', { name: /Hazte Pro/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /Hazte Pro/i }).first().click();

    // Should redirect to /login — never show the raw "Unauthorized" message
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('/login');

    // The raw backend error must never appear in the UI
    await expect(page.getByText('Unauthorized')).not.toBeVisible();
    await expect(page.getByText('User not found')).not.toBeVisible();
  });
});

test.describe('/planes — checkout con sesión (sellerContext)', () => {
  test('"Hazte Pro" con sesión inicia checkout en Stripe', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    // Mock the checkout API to return a known Stripe URL without hitting Stripe
    await page.route('**/billing/checkout', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_e2e' }),
      });
    });

    // Intercept the Stripe navigation so it doesn't leave the test domain
    await page.route('https://checkout.stripe.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Stripe Checkout Mock</body></html>',
      });
    });

    await page.goto('/planes');
    await expect(page.getByRole('button', { name: /Hazte Pro/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /Hazte Pro/i }).first().click();

    // Should navigate to checkout.stripe.com
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 10_000 });
    expect(page.url()).toContain('checkout.stripe.com');
  });
});

test.describe('/planes/exito', () => {
  test('muestra estado "activando" con session_id sin romper (sin Pro activo)', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();

    // Mock entitlements to return empty (webhook not yet processed)
    await page.route('**/billing/my-entitlements', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/planes/exito?session_id=cs_test_fake_session');

    // Should show the "activating" message — not an error
    await expect(
      page.getByRole('heading', { name: /gracias por tu compra/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Session ID displayed
    await expect(page.getByText('cs_test_fake_session')).toBeVisible();

    // "Refrescar" button present
    await expect(page.getByRole('button', { name: /refrescar/i })).toBeVisible();

    // No error state
    await expect(page.getByText(/error/i)).not.toBeVisible();
  });

  test('muestra "Ya eres Pro" cuando el entitlement está activo', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();

    // proContext user has a real PRO_SUBSCRIPTION entitlement in DB
    await page.goto('/planes/exito?session_id=cs_test_pro_active');

    await expect(
      page.getByRole('heading', { name: /ya eres pro/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole('link', { name: /ver mi suscripción/i })).toBeVisible();
  });
});

test.describe('/planes/cancelado', () => {
  test('muestra mensaje de cancelación con enlace a /planes', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/planes/cancelado');

    await expect(
      page.getByRole('heading', { name: /cancelado el proceso de pago/i }),
    ).toBeVisible();

    const link = page.getByRole('link', { name: /ver planes/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/planes');

    await ctx.close();
  });
});

test.describe('/perfil/suscripcion — usuario Pro', () => {
  test('ve suscripción activa y el dialog de cancelación se abre', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();

    await page.goto('/perfil/suscripcion');

    // Should not redirect to login
    await expect(page).not.toHaveURL(/\/login/);

    // Pro plan visible
    await expect(page.getByRole('heading', { name: 'Mi suscripción' })).toBeVisible();
    await expect(page.getByText('Plan Pro')).toBeVisible();
    await expect(page.getByText('Activa')).toBeVisible();

    // Cancel button present
    const cancelBtn = page.getByRole('button', { name: /cancelar suscripción/i });
    await expect(cancelBtn).toBeVisible();

    // Click opens the AlertDialog
    await cancelBtn.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(
      page.getByText(/cancelar suscripción pro/i),
    ).toBeVisible();

    // "Mantener Pro" closes the dialog without canceling
    await page.getByRole('button', { name: /mantener pro/i }).click();
    await expect(page.getByRole('alertdialog')).not.toBeVisible();

    // Subscription still shows active
    await expect(page.getByText('Plan Pro')).toBeVisible();
  });
});
