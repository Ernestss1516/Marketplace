// RÁFAGA 4 — fricción de login (Nivel 1: vuelve a la página, no retoma la
// acción). Mecanismo único (useRequireAuth/buildLoginUrl), el bug de
// ContactButton, el middleware devolviendo callbackUrl, favoritos
// descubribles para anónimos, y el cierre del open-redirect.
//
// Usuarios/anuncios reutilizados de seed-playwright.ts (global-setup.ts):
//   listing-rf11-e2e (título "Anuncio RF.11 E2E", vendedor slug
//   "vendedor-e2e") — único anuncio ACTIVE de seller-e2e tras cada seed
//   (el resto se resetea a EXPIRED), así que /vendedor/vendedor-e2e y
//   /anuncio/listing-rf11-e2e son deterministas sin depender del orden de
//   ejecución del resto de la batería.
//
// Cada test hace login REAL vía el formulario para verificar el round-trip
// completo — pero el login está limitado a 5 intentos/15min POR CUENTA
// (RÁFAGA 3). global-setup.ts ya consume 1 intento por cuenta (para guardar
// su storageState); este archivo REPARTE sus logins entre las 6 cuentas ya
// sembradas (máx. 2 usos por cuenta aquí + 1 de global-setup = 3, muy por
// debajo del límite de 5) en vez de agotar el cupo de una sola cuenta.

import { test, expect } from '@playwright/test';

const PASSWORD = 'Test1234!';
const LISTING_SLUG = 'listing-rf11-e2e';
const SELLER_SLUG = 'vendedor-e2e';

async function loginViaForm(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

test.describe('RÁFAGA 4 — fricción de login (Nivel 1)', () => {
  test('ContactButton: anónimo → login → vuelve AL ANUNCIO (bug de redirect= arreglado)', async ({ page }) => {
    await page.goto(`/anuncio/${LISTING_SLUG}`);
    await page.getByRole('button', { name: 'Contactar con el vendedor' }).first().click();

    await expect(page).toHaveURL(
      new RegExp(`/login\\?callbackUrl=${encodeURIComponent(`/anuncio/${LISTING_SLUG}`)}$`),
    );

    await loginViaForm(page, 'buyer-e2e@example.com');

    await expect(page).toHaveURL(new RegExp(`/anuncio/${LISTING_SLUG}$`));
  });

  test('middleware: /publicar anónimo → login → vuelve a /publicar', async ({ page }) => {
    await page.goto('/publicar');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fpublicar$/);
    // admin-e2e ya no sirve aquí: los ADMIN están bloqueados en el /login
    // público (decisión posterior — solo entran por /admin/login).
    await loginViaForm(page, 'moderator-e2e@example.com');
    await expect(page).toHaveURL(/\/publicar$/);
  });

  test('middleware: /mensajes anónimo → login → vuelve a /mensajes', async ({ page }) => {
    await page.goto('/mensajes');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fmensajes$/);
    await loginViaForm(page, 'moderator-e2e@example.com');
    await expect(page).toHaveURL(/\/mensajes$/);
  });

  test('middleware: /favoritos anónimo → login → vuelve a /favoritos', async ({ page }) => {
    await page.goto('/favoritos');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffavoritos$/);
    await loginViaForm(page, 'editor-e2e@example.com');
    await expect(page).toHaveURL(/\/favoritos$/);
  });

  test('middleware: /mis-creditos anónimo → login → vuelve a /mis-creditos', async ({ page }) => {
    await page.goto('/mis-creditos');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fmis-creditos$/);
    await loginViaForm(page, 'pro-e2e@example.com');
    await expect(page).toHaveURL(/\/mis-creditos$/);
  });

  test('favoritos (ficha): el corazón se ve para anónimos y, al pulsarlo, va a login con vuelta a la MISMA ficha', async ({ page }) => {
    await page.goto(`/anuncio/${LISTING_SLUG}`);

    const heartBtn = page.getByTestId('favorite-button-detail');
    await expect(heartBtn).toBeVisible();

    await heartBtn.click();
    await expect(page).toHaveURL(
      new RegExp(`/login\\?callbackUrl=${encodeURIComponent(`/anuncio/${LISTING_SLUG}`)}$`),
    );

    await loginViaForm(page, 'buyer-e2e@example.com');
    await expect(page).toHaveURL(new RegExp(`/anuncio/${LISTING_SLUG}$`));
  });

  test('favoritos (tarjeta): el corazón se ve para anónimos en la parrilla del vendedor y redirige a login con vuelta a esa página', async ({ page }) => {
    await page.goto(`/vendedor/${SELLER_SLUG}`);

    // Localizador preciso al card del anuncio RF.11 (el Link envuelve toda la
    // tarjeta) — no depende de cuántas otras tarjetas rendericen ni de su orden.
    const heartBtn = page
      .locator(`a[href="/anuncio/${LISTING_SLUG}"]`)
      .getByRole('button', { name: 'Guardar en favoritos' });
    await expect(heartBtn).toBeVisible();

    await heartBtn.click();
    await expect(page).toHaveURL(
      new RegExp(`/login\\?callbackUrl=${encodeURIComponent(`/vendedor/${SELLER_SLUG}`)}$`),
    );

    await loginViaForm(page, 'moderator-e2e@example.com');
    await expect(page).toHaveURL(new RegExp(`/vendedor/${SELLER_SLUG}$`));
  });

  test('Comprar Pro: anónimo → login → vuelve a /planes (sigue funcionando)', async ({ page }) => {
    await page.goto('/planes');
    await page.getByRole('button', { name: 'Hazte Pro' }).first().click();
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fplanes$/);
    await loginViaForm(page, 'editor-e2e@example.com');
    await expect(page).toHaveURL(/\/planes$/);
  });

  test('SEGURIDAD — open redirect: callbackUrl a dominio externo se ignora, cae al default', async ({ page }) => {
    await page.goto('/login?callbackUrl=https%3A%2F%2Fevil.example.com');
    // admin-e2e ya no sirve aquí: bloqueado en el /login público.
    await loginViaForm(page, 'moderator-e2e@example.com');
    await expect(page).not.toHaveURL(/evil\.example\.com/);
    await expect(page).toHaveURL(/\/mis-anuncios/);
  });

  test('SEGURIDAD — open redirect: callbackUrl protocol-relative (//evil) también se ignora', async ({ page }) => {
    await page.goto('/login?callbackUrl=%2F%2Fevil.example.com');
    await loginViaForm(page, 'pro-e2e@example.com');
    await expect(page).not.toHaveURL(/evil\.example\.com/);
    await expect(page).toHaveURL(/\/mis-anuncios/);
  });
});
