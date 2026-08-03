// H8 Bloque D fase 4 — Playwright E2E: banners de difusión + enlaces compartibles.
//
// Backend (CRUD admin, getActiveBanners por placement, 403 moderator, AuditLog)
// ya cubierto en h8-d4-banners.e2e-spec.ts (Jest). Aquí solo lo verificable
// end-to-end: el admin crea banners y aparecen/desaparecen en la web según
// ubicación/estado, el descarte persiste, y el botón compartir funciona.

import { test, expect } from './fixtures/auth';

function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createBanner(
  page: import('@playwright/test').Page,
  opts: {
    title: string;
    text: string;
    placements: ('Home' | 'Mis anuncios')[];
    linkUrl?: string;
    linkText?: string;
    variant?: 'Info' | 'Promo' | 'Aviso';
    shareable?: boolean;
  },
) {
  await page.goto('/admin/banners');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Nuevo banner' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#banner-title').fill(opts.title);
  await page.locator('#banner-text').fill(opts.text);
  if (opts.linkUrl) await page.locator('#banner-link-url').fill(opts.linkUrl);
  if (opts.linkText) await page.locator('#banner-link-text').fill(opts.linkText);
  const placementTestId: Record<'Home' | 'Mis anuncios', string> = {
    Home: 'banner-placement-HOME',
    'Mis anuncios': 'banner-placement-MIS_ANUNCIOS',
  };
  for (const placement of opts.placements) {
    await page.getByTestId(placementTestId[placement]).click();
  }
  if (opts.variant) {
    await page.locator('#banner-variant').click();
    await page.getByRole('option', { name: opts.variant }).click();
  }
  if (opts.shareable) {
    await page.getByTestId('banner-shareable').click();
  }

  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const toLocal = (d: Date) => d.toISOString().slice(0, 16);
  await page.locator('#banner-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
  await page.locator('#banner-ends-at').fill(toLocal(later));

  await page.getByRole('button', { name: 'Crear banner' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
}

test.describe('Admin — gestión de banners', () => {
  test('crea un banner y lo ve en el listado con sus ubicaciones', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const title = uniqueTitle('E2E Banner');

    await createBanner(page, {
      title,
      text: 'Texto de prueba del banner',
      placements: ['Home', 'Mis anuncios'],
    });

    const row = page.locator('tr').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Home');
    await expect(row).toContainText('Mis anuncios');
    await expect(row).toContainText('Vigente');
  });

  test('desactivar un banner desde el listado lo quita de la web', async ({ adminContext }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Deactivate');

    await createBanner(adminPage, {
      title,
      text: 'Se desactiva y desaparece',
      placements: ['Home'],
    });

    const homePage = await adminContext.newPage();
    await homePage.goto('/');
    await expect(homePage.getByText(title)).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator('tr').filter({ hasText: title });
    await row.getByRole('button', { name: 'Desactivar' }).click();
    await expect(row.getByText('Inactivo')).toBeVisible({ timeout: 10_000 });

    await homePage.reload();
    await expect(homePage.getByText(title)).not.toBeVisible();
  });
});

test.describe('Banners en la web', () => {
  test('banner con ambos placements aparece en home y en mis-anuncios; con uno solo, aparece solo ahí', async ({
    adminContext,
    sellerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const bothTitle = uniqueTitle('E2E Both');
    const homeOnlyTitle = uniqueTitle('E2E HomeOnly');

    await createBanner(adminPage, {
      title: bothTitle,
      text: 'Aparece en ambas ubicaciones',
      placements: ['Home', 'Mis anuncios'],
    });
    await createBanner(adminPage, {
      title: homeOnlyTitle,
      text: 'Solo en home',
      placements: ['Home'],
    });

    const homePage = await sellerContext.newPage();
    await homePage.goto('/');
    await expect(homePage.getByText(bothTitle)).toBeVisible({ timeout: 10_000 });
    await expect(homePage.getByText(homeOnlyTitle)).toBeVisible();

    const misAnunciosPage = await sellerContext.newPage();
    await misAnunciosPage.goto('/mis-anuncios');
    await expect(misAnunciosPage.getByText(bothTitle)).toBeVisible({ timeout: 10_000 });
    await expect(misAnunciosPage.getByText(homeOnlyTitle)).not.toBeVisible();
  });

  test('cerrar un banner (×) lo oculta y no reaparece tras recargar', async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Dismiss');

    await createBanner(adminPage, {
      title,
      text: 'Este banner se descarta',
      placements: ['Home'],
    });

    const page = await buyerContext.newPage();
    await page.goto('/');
    const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await banner.getByTestId('banner-dismiss-button').click();
    await expect(banner).not.toBeVisible();

    await page.reload();
    await expect(page.locator('[data-testid="banner"]').filter({ hasText: title })).not.toBeVisible();
  });

  test('banner con enlace y compartible: el enlace navega y el botón compartir copia al portapapeles', { tag: '@2b' }, async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Share');

    await createBanner(adminPage, {
      title,
      text: 'Banner compartible con enlace',
      placements: ['Home'],
      linkUrl: '/planes',
      linkText: 'Ver planes',
      variant: 'Promo',
      shareable: true,
    });

    await buyerContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await buyerContext.newPage();
    // Fuerza la ruta de "escritorio" (portapapeles) de forma determinista,
    // sin depender de si el Chromium de CI expone navigator.share.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
    });
    await page.goto('/');

    const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await banner.getByRole('link', { name: 'Ver planes' }).click();
    await expect(page).toHaveURL(/\/planes/);

    await page.goBack();
    const bannerAgain = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await bannerAgain.getByTestId('banner-share-button').click();
    await expect(bannerAgain.getByTestId('banner-share-button')).toContainText('Enlace copiado');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('/planes');
  });
});
