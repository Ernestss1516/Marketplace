// Auth fixtures for Playwright e2e tests.
// Both contexts are pre-authenticated via storageState saved by global-setup.ts.
// They are passed as fixtures so individual tests don't repeat the login UI flow.

import { test as base, type BrowserContext } from '@playwright/test';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname);

export const test = base.extend<{
  sellerContext: BrowserContext;
  buyerContext: BrowserContext;
}>({
  sellerContext: async ({ browser }, use) => {
    const ctx = await browser.newContext({
      storageState: path.join(FIXTURES_DIR, 'seller.storageState.json'),
    });
    await use(ctx);
    await ctx.close();
  },

  buyerContext: async ({ browser }, use) => {
    const ctx = await browser.newContext({
      storageState: path.join(FIXTURES_DIR, 'buyer.storageState.json'),
    });
    await use(ctx);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
