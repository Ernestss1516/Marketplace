// RL5.1-C — Playwright E2E: subida de avatar de perfil.
//
// Verifica el flujo completo:
//   1. Subir un avatar desde /perfil → preview inmediato → guardar.
//   2. Recargar /perfil → el avatar persiste.
//   3. El avatar aparece en el perfil público /vendedor/[slug].

import * as path from 'path';
import { test, expect } from './fixtures/auth';

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.describe('RL5.1-C — Avatar de perfil', () => {

  test('subir avatar → guardar → persiste en perfil y perfil público', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();

    // Upload via the hidden file input.
    await page.locator('[data-testid="avatar-input"]').setInputFiles(TEST_IMAGE);

    // Wait for upload to finish: "Cambiar foto" re-enables.
    await expect(page.getByRole('button', { name: 'Cambiar foto' })).toBeEnabled({ timeout: 15_000 });

    // Avatar preview shows the uploaded URL (inside shadcn Avatar → <img>).
    const avatarImg = page.locator('[data-testid="perfil-avatar"] img').first();
    const previewSrc = await avatarImg.getAttribute('src', { timeout: 5_000 }).catch(() => null);
    expect(previewSrc).toBeTruthy();
    expect(previewSrc).toContain('avatars/');

    // Save profile.
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Perfil actualizado correctamente')).toBeVisible({ timeout: 8_000 });

    // Reload /perfil — avatar must persist.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
    const reloadedSrc = await page.locator('[data-testid="perfil-avatar"] img').first().getAttribute('src').catch(() => null);
    expect(reloadedSrc).toBeTruthy();
    expect(reloadedSrc).toContain('avatars/');

    // Public seller profile also shows the avatar.
    await page.goto('/vendedor/vendedor-e2e');
    await page.waitForLoadState('networkidle');
    const publicAvatarImg = page.locator('img[alt="Vendedor E2E"]').first();
    await expect(publicAvatarImg).toBeVisible({ timeout: 8_000 });
    const publicSrc = await publicAvatarImg.getAttribute('src');
    expect(publicSrc).toBeTruthy();
    expect(publicSrc).toContain('avatars/');
  });

  test('subir archivo no-imagen → mensaje de error, formulario sigue funcional', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();

    // Inject a non-image buffer directly — bypasses the <input accept> restriction.
    await page.locator('[data-testid="avatar-input"]').setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is definitely not an image'),
    });

    // Button re-enables after the upload error.
    await expect(page.getByRole('button', { name: 'Cambiar foto' })).toBeEnabled({ timeout: 10_000 });

    // Error message is shown.
    await expect(page.getByText('Error al subir la imagen')).toBeVisible({ timeout: 5_000 });

    // Save button remains enabled — form is not broken.
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

});
