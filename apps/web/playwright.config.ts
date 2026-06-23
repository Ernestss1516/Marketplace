import { defineConfig, devices } from '@playwright/test';

// Playwright e2e config for the Marketplace frontend.
// Tests live in apps/web/e2e/ (created in RT.5).
//
// Local workflow:
//   - reuseExistingServer: true  → start both servers manually with test env vars
//     before running `pnpm test:e2e`; Playwright reuses them.
//   - Backend must use apps/api/.env.test (marketplace_test DB, listings_test index).
//
// CI workflow (RT.5):
//   - reuseExistingServer: false → Playwright starts both servers automatically.
//   - The CI job injects DATABASE_URL, MEILI_INDEX_NAME etc. via env vars.

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // Backend: start with test env vars so it uses marketplace_test DB and
      // listings_test Meilisearch index. In CI these vars come from the workflow.
      command: 'pnpm --filter @marketplace/api dev',
      url: 'http://localhost:3001/api',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @marketplace/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
