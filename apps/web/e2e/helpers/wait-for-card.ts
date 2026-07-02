import type { Page } from '@playwright/test';

/**
 * Actively reloads `url` until a card link containing `title` appears in the
 * server-rendered HTML, then returns.
 *
 * Category and search pages (/coches, /vehiculos, /busqueda…) are pure SSR:
 * the server queries Meilisearch at request time and returns a static snapshot.
 * After a publication the card only becomes visible on a *fresh* page load once
 * two async steps have completed:
 *   1. The BullMQ 'index' job has run and indexListing() has finished.
 *   2. Meilisearch has processed its internal indexing task (waitForTask).
 *
 * Passive `toBeVisible({ timeout: N })` on a static SSR DOM never triggers a
 * re-render, so it either finds the card on the first load or times out.
 * Active polling with page reloads is the correct strategy.
 */
export async function waitForCard(
  page: Page,
  url: string,
  title: string,
  { intervalMs = 1_500, timeoutMs = 45_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (true) {
    attempts++;
    await page.goto(url);
    const card = page
      .locator('a[href*="/anuncio/"]')
      .filter({ hasText: title })
      .first();

    if (await card.isVisible()) {
      console.log(`[waitForCard] found after ${attempts} reload(s): "${title.slice(0, 50)}"`);
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(intervalMs, remaining));
  }

  throw new Error(
    `[waitForCard] Card not found after ${attempts} reload(s) (${timeoutMs}ms timeout).\n` +
      `  url:   ${url}\n` +
      `  title: ${title.slice(0, 80)}\n` +
      `Meilisearch indexing did not complete in time.`,
  );
}
