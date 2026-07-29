import { defineConfig, devices } from '@playwright/test';
import { config as dotenvParse } from 'dotenv';
import * as path from 'path';

// Parse .env.test into a plain object to inject into the backend webServer env.
// processEnv: {} → parse-only, never touches process.env.
// Injecting vars explicitly guarantees the backend uses the test DB regardless of
// how the Nest CLI handles NODE_ENV in its child process.
const apiDir = path.join(__dirname, '..', 'api');
const testEnv = dotenvParse({
  path: path.join(apiDir, '.env.test'),
  processEnv: {},
}).parsed ?? {};

// Playwright e2e config for the Marketplace frontend.
// Tests live in apps/web/e2e/ (created in RT.5).
//
// Local workflow:
//   - reuseExistingServer: true  → start both servers manually with test env vars
//     before running `pnpm test:e2e`; Playwright reuses them.
//   - Backend must expose port 3001 and use marketplace_test DB.
//
// CI workflow (RT.5):
//   - reuseExistingServer: false → Playwright starts both servers automatically.
//   - The CI job injects DATABASE_URL, MEILI_INDEX_NAME etc. via env vars.

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // R9 — libera el candado que impide correr esta batería y la de backend a la
  // vez (apps/api/test/e2e-lock.js). Sin teardown el candado quedaría cogido
  // hasta que el PID muriera.
  globalTeardown: './e2e/global-teardown.ts',
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
      // Backend: all test env vars injected explicitly so they are available
      // regardless of how nest-cli manages NODE_ENV in its child process.
      // .env.test uses PORT=3001 (Jest API tests use supertest in-process, no port binding).
      command: 'pnpm --filter @marketplace/api dev',
      // /api/categories is a public endpoint guaranteed to return 200 once NestJS
      // and Prisma are fully ready. /api root has no handler → 404.
      url: 'http://localhost:3001/api/categories',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // testEnv spread first so CI job-level vars (injected into process.env)
      // always win over .env.test values. Locally process.env lacks these vars
      // so testEnv provides the defaults (masterKey_dev_change_me, etc.).
      env: { ...testEnv, ...process.env, PORT: '3001' },
    },
    {
      // CI runs against a production build (`next start`), not `next dev`.
      // `next dev` has a built-in dev-only memory watchdog (server/lib/start-server.ts:
      // `if (isDev) { if (used_heap_size > 0.8 * heap_size_limit) restart }`) that
      // self-restarts the process once V8 heap usage crosses 80% — dev mode retains far
      // more in memory (webpack HMR module cache, source maps) than a production build,
      // and the ~9min/111-test suite on a memory-constrained CI runner was enough to
      // cross that threshold mid-suite, killing whatever test was mid-`goto` at the time
      // ("Target page has been closed"). `next start` never runs that check (isDev-gated),
      // so it doesn't apply here. CI has its own "Build frontend for e2e" step beforehand
      // (`next build`) since `next start` requires an existing `.next` build.
      command: process.env.CI
        ? 'pnpm --filter @marketplace/web start'
        : 'pnpm --filter @marketplace/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
