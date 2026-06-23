// Critical path E2E: login → publish (wizard) → search → view listing → contact
//
// Two users:
//   seller-e2e@example.com  — logs in, goes through the publish wizard
//   buyer-e2e@example.com   — searches, opens the listing, sends the first message
//
// Prerequisites (local): stack running with .env.test vars (see global-setup.ts).
// Run: pnpm --filter @marketplace/web test:e2e

import * as path from 'path';
import { test, expect } from './fixtures/auth';

// Unique title per run so Meilisearch search returns exactly this listing.
const LISTING_TITLE = `Móvil E2E ${Date.now()}`;
const LISTING_DESCRIPTION = 'Terminal de prueba para el recorrido E2E. Buen estado.';

test('publicar → buscar → ver ficha → contactar', async ({ sellerContext, buyerContext }) => {

  // ════════════════════════════════════════════════════════════════════════════
  // PARTE 1 — SELLER: publicar el anuncio a través del wizard
  // ════════════════════════════════════════════════════════════════════════════

  const sellerPage = await sellerContext.newPage();

  // Verify session is active (seller is already authenticated via storageState)
  await sellerPage.goto('/mis-anuncios');
  await expect(sellerPage).not.toHaveURL(/\/login/);

  await sellerPage.goto('/publicar');

  // ── Step 1: Categoría ──────────────────────────────────────────────────────
  await expect(
    sellerPage.getByRole('heading', { name: 'Elige una categoría' })
  ).toBeVisible();

  // Navigate into Electrónica (parent) then select Móviles (leaf → auto-advances)
  await sellerPage.getByRole('button', { name: 'Electrónica' }).click();
  await sellerPage.getByRole('button', { name: 'Móviles' }).click();

  // Wizard auto-advances to Step 2
  await expect(sellerPage.getByRole('heading', { name: 'Fotos' })).toBeVisible();

  // ── Step 2: Fotos ──────────────────────────────────────────────────────────
  // setInputFiles triggers the hidden file input directly (no click on the zone needed)
  await sellerPage
    .locator('[data-testid="foto-input"]')
    .setInputFiles(path.join(__dirname, 'fixtures', 'test-image.png'));

  // Wait for upload to complete: the "Portada" badge appears on the first photo.
  // { exact: true } + .first() avoids strict-mode failure when "Portada" also
  // appears in help text elsewhere on the page.
  await expect(sellerPage.getByText('Portada', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await sellerPage.getByRole('button', { name: 'Siguiente' }).click();
  await expect(
    sellerPage.getByRole('heading', { name: 'Datos del anuncio' })
  ).toBeVisible();

  // ── Step 3: Datos ──────────────────────────────────────────────────────────
  await sellerPage.locator('#title').fill(LISTING_TITLE);
  await sellerPage.locator('#description').fill(LISTING_DESCRIPTION);

  // Select type: Producto (Radio — associated via htmlFor="type-product")
  await sellerPage.getByLabel('Producto').click();

  // Select condition: open Radix Select, pick "Buen estado"
  await sellerPage.locator('#condition').click();
  await sellerPage.getByRole('option', { name: 'Buen estado' }).click();

  // Price mode defaults to "fixed"; just fill the amount
  await sellerPage.locator('#price').fill('25');

  await sellerPage.getByRole('button', { name: 'Siguiente' }).click();

  // ── Step 4: Atributos (Móviles: brand/ram, both optional — skip) ───────────
  await expect(
    sellerPage.getByRole('heading', { name: 'Atributos' })
  ).toBeVisible();
  await sellerPage.getByRole('button', { name: 'Siguiente' }).click();

  // ── Step 5: Ubicación ──────────────────────────────────────────────────────
  await expect(
    sellerPage.getByRole('heading', { name: 'Ubicación' })
  ).toBeVisible();
  await sellerPage.locator('#city').fill('Madrid');
  await sellerPage.locator('#province').fill('Madrid');

  // "Revisar" (last step before preview)
  await sellerPage.getByRole('button', { name: 'Revisar' }).click();

  // ── Step 6: Previsualización ───────────────────────────────────────────────
  await expect(
    sellerPage.getByRole('heading', { name: 'Previsualización' })
  ).toBeVisible();
  // The summary card shows the listing title
  await expect(sellerPage.getByText(LISTING_TITLE)).toBeVisible();

  // Publish — button is enabled because we have ≥1 valid photo
  await sellerPage.getByRole('button', { name: 'Publicar ahora' }).click();

  // After publish the wizard redirects to the listing page
  await sellerPage.waitForURL('**/anuncio/**', { timeout: 20_000 });
  await expect(sellerPage.locator('h1')).toContainText(LISTING_TITLE);

  // Capture the slug from the URL for the buyer's contact step
  const listingUrl = sellerPage.url();
  const listingSlug = listingUrl.split('/anuncio/')[1];
  expect(listingSlug).toBeTruthy();

  // ════════════════════════════════════════════════════════════════════════════
  // PARTE 2 — BUYER: buscar, ver ficha, contactar
  // ════════════════════════════════════════════════════════════════════════════

  const buyerPage = await buyerContext.newPage();

  // Verify buyer session is active
  await buyerPage.goto('/mis-anuncios');
  await expect(buyerPage).not.toHaveURL(/\/login/);

  // ── Paso 3: Buscar ─────────────────────────────────────────────────────────
  // BullMQ indexes asynchronously → poll until Meilisearch returns the listing.
  // Reload the search page on each attempt instead of fixed sleeps.
  await buyerPage.goto(`/busqueda?q=${encodeURIComponent(LISTING_TITLE)}`);

  await expect(async () => {
    await buyerPage.reload();
    await expect(
      buyerPage.locator('a').filter({ hasText: LISTING_TITLE }).first()
    ).toBeVisible();
  }).toPass({ timeout: 20_000, intervals: [1000, 2000, 3000, 3000, 3000, 3000, 3000] });

  // ── Paso 4: Ver ficha ──────────────────────────────────────────────────────
  await buyerPage.locator('a').filter({ hasText: LISTING_TITLE }).first().click();
  await buyerPage.waitForURL('**/anuncio/**');
  await expect(buyerPage.locator('h1')).toContainText(LISTING_TITLE);

  // "Contactar" button appears in both mobile bar and desktop sidebar (same DOM).
  // In a Desktop Chrome viewport (1280px) the mobile bar is display:none and the
  // desktop sidebar is visible. .first() picks the sidebar-rendered button.
  await expect(
    buyerPage.getByRole('button', { name: 'Contactar con el vendedor' }).first()
  ).toBeVisible();

  // ── Paso 5: Contactar ──────────────────────────────────────────────────────
  await buyerPage.getByRole('button', { name: 'Contactar con el vendedor' }).first().click();

  // Contact form appears (buyer has emailVerified: true).
  // The form is rendered twice in the DOM (mobile bar + desktop sidebar).
  // getByPlaceholder includes display:none elements (unlike getByRole).
  // The mobile bar renders the form FIRST in DOM (md:hidden at desktop viewport),
  // the desktop sidebar renders it LAST. .last() targets the visible desktop form.
  const messageInput = buyerPage.getByPlaceholder('Escribe tu mensaje al vendedor…').last();
  await expect(messageInput).toBeVisible();
  await messageInput.fill('Hola, ¿sigue disponible el móvil?');

  await buyerPage.getByRole('button', { name: 'Enviar mensaje' }).first().click();

  // A new conversation is created and the buyer is redirected to the chat
  await buyerPage.waitForURL('**/mensajes/**', { timeout: 10_000 });
});
