// Playwright globalSetup — runs once before all tests, after webServers are ready.
//
// Responsibilities:
//   1. Load apps/api/.env.test so DATABASE_URL etc. reach child processes.
//      In CI the runner already injects these vars; dotenv leaves them untouched.
//   2. Apply pending Prisma migrations to the test DB (safe to re-run).
//   3. Seed static categories (idempotent, via seed-test.ts).
//   4. Seed Playwright users: seller-e2e and buyer-e2e (idempotent).
//   5. Log in as each user in a headless browser and save storageState so tests
//      skip the login UI entirely.
//
// storageState files are written to e2e/fixtures/ and are gitignored.
// They contain next-auth session cookies — treat as ephemeral secrets.

import { chromium, type FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import { config as loadEnv } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const API_DIR = path.join(__dirname, '..', '..', 'api');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const ENV_TEST_PATH = path.join(API_DIR, '.env.test');

export default async function globalSetup(playwrightConfig: FullConfig) {
  // ── 1. Load .env.test (no-op if vars already set by CI runner) ──────────────
  if (fs.existsSync(ENV_TEST_PATH)) {
    loadEnv({ path: ENV_TEST_PATH });
  }

  // Safety check: abort immediately if DATABASE_URL still points to the dev DB
  // so the test can never accidentally write to the real marketplace database.
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl.includes('marketplace_test')) {
    throw new Error(
      `[Playwright globalSetup] DATABASE_URL must contain "marketplace_test" but got:\n  ${dbUrl || '(empty)'}\n\n` +
      'Start the backend with .env.test variables before running Playwright tests.\n' +
      'Local: $env:NODE_ENV="test"; pnpm --filter @marketplace/api dev\n' +
      'Or:    dotenv -e apps/api/.env.test -- pnpm --filter @marketplace/api dev',
    );
  }

  const execOpts = { cwd: API_DIR, stdio: 'inherit' as const, env: { ...process.env } };

  // ── 2. Migrate test DB ───────────────────────────────────────────────────────
  execSync('npx prisma migrate deploy', execOpts);

  // ── 3. Seed categories (electronica → moviles) ───────────────────────────────
  execSync('npx ts-node --project tsconfig.json prisma/seed-test.ts', execOpts);

  // ── 4. Seed Playwright users (seller-e2e, buyer-e2e) ─────────────────────────
  execSync('npx ts-node -P tsconfig.scripts.json prisma/seed-playwright.ts', execOpts);

  // ── 5. Save storageState for both users ──────────────────────────────────────
  const baseURL =
    playwrightConfig.projects[0]?.use?.baseURL ?? 'http://localhost:3000';

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const browser = await chromium.launch();

  const users = [
    { email: 'seller-e2e@example.com', file: 'seller.storageState.json' },
    { email: 'buyer-e2e@example.com',  file: 'buyer.storageState.json'  },
    { email: 'pro-e2e@example.com',    file: 'pro.storageState.json'    },
  ];

  for (const user of users) {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseURL}/login`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill('Test1234!');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    // Wait for the redirect away from /login without assuming the destination.
    // next-auth may resolve the session before Next.js Router fires the
    // callbackUrl push, so the landing route is not guaranteed.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    // Navigate explicitly to a protected route to confirm the session cookie is
    // live and middleware does not bounce us back to login.
    await page.goto(`${baseURL}/mis-anuncios`);
    const finalUrl = page.url();
    if (finalUrl.includes('/login')) {
      throw new Error(
        `[globalSetup] Session not established for ${user.email} — ` +
        `/mis-anuncios redirected to: ${finalUrl}`,
      );
    }

    await context.storageState({ path: path.join(FIXTURES_DIR, user.file) });
    await context.close();
  }

  await browser.close();
}
