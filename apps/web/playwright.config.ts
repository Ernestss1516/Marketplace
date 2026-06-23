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
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  // The critical-path test is long: publish wizard + Meilisearch wait + contact.
  timeout: 90_000,

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
      // Backend: NODE_ENV=test triggers .env.test loading (via ConfigModule envFilePath).
      // In CI, the workflow injects DATABASE_URL=marketplace_test etc. directly and
      // those take precedence over .env.test (dotenv never overrides existing env vars).
      // In local, reuseExistingServer:true reuses the manually-started server.
      command: 'pnpm --filter @marketplace/api dev',
      // /api/categories is a public endpoint guaranteed to return 200 once NestJS
      // and Prisma are fully ready. /api root has no handler → 404.
      url: 'http://localhost:3001/api/categories',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'pnpm --filter @marketplace/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
