// H8 Bloque E — Playwright E2E: badge "Vendedor de confianza".
//
// Reutiliza pro-e2e@example.com (slug: usuario-pro-e2e, listing: listing-pro-e2e) para
// probar también que un vendedor Pro Y de confianza muestra ambos badges sin chocar.
// El test es idempotente: si un run anterior dejó al usuario marcado, lo desmarca antes
// de empezar, y siempre termina desmarcándolo — no deja estado sucio para otros specs.

import { test, expect } from './fixtures/auth';

const PRO_SLUG = 'usuario-pro-e2e';
const PRO_LISTING_SLUG = 'listing-pro-e2e';

test.describe('Badge "Vendedor de confianza"', () => {
  test('ADMIN marca/desmarca desde /admin/usuarios; el badge aparece y desaparece en perfil y ficha', async ({
    adminContext,
    browser,
  }) => {
    const adminPage = await adminContext.newPage();
    // waitUntil: 'domcontentloaded' (no 'load', el default) — evita que goto() se quede
    // esperando el evento load completo (recursos lentos/HMR) hasta agotar el timeout del
    // test entero. La espera determinista real es el expect().toBeVisible() de abajo, sobre
    // un elemento concreto, con su propio timeout generoso — no confiamos en el goto en sí.
    await adminPage.goto('/admin/usuarios', { waitUntil: 'domcontentloaded' });

    const searchInput = adminPage.getByPlaceholder(/buscar por nombre o email/i);
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill('Usuario Pro E2E');
    await adminPage.getByRole('button', { name: 'Buscar' }).click();

    const row = adminPage.locator('tr', { hasText: 'Usuario Pro E2E' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Idempotencia: si un run anterior dejó al usuario marcado, desmarcarlo primero.
    if (await row.getByText('De confianza').isVisible()) {
      await row.getByRole('button', { name: 'Quitar' }).click();
      await expect(row.getByText('De confianza')).not.toBeVisible({ timeout: 5_000 });
    }

    // Marcar como de confianza.
    await row.getByRole('button', { name: 'Marcar' }).click();
    await expect(row.getByText('De confianza')).toBeVisible({ timeout: 5_000 });

    const publicPage = await (await browser.newContext()).newPage();
    try {
      // El perfil público muestra AMBOS badges (Pro + confianza) sin amontonarse.
      await publicPage.goto(`/vendedor/${PRO_SLUG}`, { waitUntil: 'domcontentloaded' });
      await expect(publicPage.getByTestId('seller-pro-badge')).toBeVisible({ timeout: 10_000 });
      await expect(publicPage.getByTestId('seller-trusted-badge')).toBeVisible();
      await expect(publicPage.getByTestId('seller-trusted-badge')).toContainText(
        'Vendedor de confianza',
      );

      // La ficha del anuncio (SellerCard) también muestra el badge de confianza.
      await publicPage.goto(`/anuncio/${PRO_LISTING_SLUG}`, { waitUntil: 'domcontentloaded' });
      await expect(publicPage.getByTestId('seller-trusted-badge')).toBeVisible({
        timeout: 10_000,
      });

      // Desmarcar — el badge desaparece del backoffice y de las páginas públicas.
      await adminPage.bringToFront();
      await row.getByRole('button', { name: 'Quitar' }).click();
      await expect(row.getByText('De confianza')).not.toBeVisible({ timeout: 5_000 });

      await publicPage.goto(`/vendedor/${PRO_SLUG}`, { waitUntil: 'domcontentloaded' });
      // El badge Pro no se ve afectado — son independientes.
      await expect(publicPage.getByTestId('seller-pro-badge')).toBeVisible({ timeout: 10_000 });
      await expect(publicPage.getByTestId('seller-trusted-badge')).not.toBeVisible();

      // NOTA: NO se repite esta comprobación en /anuncio/[slug]. ListingsService.findBySlug
      // cachea la ficha completa (incluido el sub-objeto seller) en Redis 5 minutos
      // (mismo lag ya existente para avatarUrl/name); desmarcar a un vendedor no invalida
      // esa caché, así que una ficha ya visitada puede seguir mostrando el badge hasta que
      // expire. No es una regresión de esta ráfaga — es el mismo comportamiento que ya
      // tenían el resto de campos del vendedor cacheados ahí.
    } finally {
      // Restaurar estado limpio incluso si una aserción intermedia falla.
      if (await row.getByText('De confianza').isVisible().catch(() => false)) {
        await row.getByRole('button', { name: 'Quitar' }).click();
      }
    }
  });

  test('perfil de un vendedor normal (no trusted) no muestra el badge — nada roto', async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto('/vendedor/vendedor-e2e', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Vendedor E2E' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('seller-trusted-badge')).not.toBeVisible();
  });

  test('ficha de anuncio de un vendedor normal no muestra el badge de confianza', async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto('/anuncio/listing-rf11-e2e', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('seller-trusted-badge')).not.toBeVisible();
  });
});
