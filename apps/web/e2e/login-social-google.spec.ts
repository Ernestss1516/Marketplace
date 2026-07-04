// Login social con Google (Hito 7, parte 2 — frontend).
//
// El flujo OAuth completo requiere una cuenta Google real y se verifica MANUALMENTE
// (ver docs/estado-tecnico.md). Aquí solo comprobamos lo verificable sin OAuth real:
// el botón existe en /login y /registro, y al pulsarlo Next-Auth efectivamente
// arranca el intercambio OAuth (redirige hacia accounts.google.com). Interceptamos
// esa navegación para no depender de la red real ni de Google en CI.

import { test, expect } from '@playwright/test';

async function expectGoogleSignInStarts(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: 'Continuar con Google' });
  await expect(button).toBeVisible();

  let googleRequestUrl: string | null = null;
  await page.route('https://accounts.google.com/**', async (route) => {
    googleRequestUrl = route.request().url();
    await route.abort();
  });

  await button.click();

  await expect.poll(() => googleRequestUrl, { timeout: 10_000 }).toContain(
    'accounts.google.com',
  );
}

test('el botón "Continuar con Google" en /login dispara el flujo OAuth', async ({ page }) => {
  await page.goto('/login');
  await expectGoogleSignInStarts(page);
});

test('el botón "Continuar con Google" en /registro dispara el flujo OAuth', async ({ page }) => {
  await page.goto('/registro');
  await expectGoogleSignInStarts(page);
});

test('el botón de Google se añade sin romper el formulario de email/contraseña', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
});
