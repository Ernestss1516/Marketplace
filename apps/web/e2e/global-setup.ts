// Playwright globalSetup — runs once before all tests, after webServers are ready.
//
// Responsibilities:
//   1. Load apps/api/.env.test so DATABASE_URL etc. reach child processes.
//      In CI the runner already injects these vars; dotenv leaves them untouched.
//   2. Apply pending Prisma migrations to the test DB (safe to re-run).
//   3. Seed static categories (idempotent, via seed-test.ts).
//   4. Seed Playwright users: seller-e2e, buyer-e2e, admin-e2e, moderator-e2e,
//      editor-e2e, etc. (idempotent).
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

/**
 * Candado compartido con la batería e2e de backend (R9).
 *
 * `require` en tiempo de ejecución y no `import`: el módulo vive en `apps/api` y
 * es un `.js` sin tipos, fuera del `rootDir` de este paquete. Es la misma vía por
 * la que ya se comparte `flush-redis-test-db.js` con Jest — una sola fuente para
 * las dos baterías, en vez de dos copias que se desincronizan.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const e2eLock = require(path.join(__dirname, '..', '..', 'api', 'test', 'e2e-lock.js')) as {
  acquire: (owner: string) => void;
  release: (owner: string) => void;
};

export default async function globalSetup(playwrightConfig: FullConfig) {
  // ── 0. ANTES DE TODO: no correr a la vez que la batería de backend ──────────
  // Comparten marketplace_test y Redis db 1. Si la otra está en marcha, esto
  // aborta con un mensaje claro en vez de producir rojos falsos (y de que el
  // `cleanDb` de una trunque la BD a mitad del setup de la otra).
  e2eLock.acquire('playwright');

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

  // Same principle as the DATABASE_URL check above, for Redis: dev and test share
  // one Redis server, isolated only by logical db (REDIS_URL's path segment, e.g.
  // .../1 — see apps/api/src/infra/redis/redis-connection.ts). Catch a missing
  // suffix here with a clear message instead of the flush script's generic guard.
  const redisUrl = process.env.REDIS_URL ?? '';
  if (!/\/[1-9]\d*$/.test(redisUrl)) {
    throw new Error(
      `[Playwright globalSetup] REDIS_URL must select a non-zero db (e.g. redis://localhost:6379/1) but got:\n  ${redisUrl || '(empty)'}\n\n` +
      'Otherwise this run\'s FLUSHDB and rate-limit counters would collide with a dev server on the same Redis.',
    );
  }

  const execOpts = { cwd: API_DIR, stdio: 'inherit' as const, env: { ...process.env } };

  // ── 2. Migrate test DB ───────────────────────────────────────────────────────
  execSync('npx prisma migrate deploy', execOpts);

  // ── 3. Seed categories (electronica → moviles) ───────────────────────────────
  execSync('npx ts-node --project tsconfig.json prisma/seed-test.ts', execOpts);

  // ── 4. Seed Playwright users (seller-e2e, buyer-e2e) ─────────────────────────
  execSync('npx ts-node -P tsconfig.scripts.json prisma/seed-playwright.ts', execOpts);

  // RÁFAGA 3 — /auth/login está limitado a 5 intentos/15min por cuenta. Este
  // globalSetup ya loguea 6 cuentas (una vez cada una), y varios specs además
  // llaman a POST /auth/login directamente (p. ej. loginViaApi en
  // producto-servicio-flujo.spec.ts) o repiten el login por UI (p. ej.
  // auth-friction.spec.ts) — sin este flush, una corrida repetida en local (o
  // varios specs compartiendo las mismas cuentas sembradas dentro de la MISMA
  // corrida) puede agotar el cupo de una cuenta y provocar 429 en cascada en
  // specs sin ninguna relación con auth. Ahora hace FLUSHDB completo (seguro:
  // db de test aislada de la de dev, con guard si REDIS_URL apuntara a db 0
  // — ver apps/api/src/infra/redis/redis-connection.ts). Mismo script que usa
  // el globalSetup de Jest (apps/api/test/flush-redis-test-db.js) — una sola fuente.
  execSync('node test/flush-redis-test-db.js', execOpts);

  // ── 5. Save storageState for both users ──────────────────────────────────────
  const baseURL =
    playwrightConfig.projects[0]?.use?.baseURL ?? 'http://localhost:3000';

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const browser = await chromium.launch();

  const users = [
    { email: 'seller-e2e@example.com',    file: 'seller.storageState.json'    },
    { email: 'buyer-e2e@example.com',     file: 'buyer.storageState.json'     },
    { email: 'pro-e2e@example.com',       file: 'pro.storageState.json'       },
    // ADMIN solo puede entrar por /admin/login — el /login público lo rechaza
    // (decisión de diseño; ver AuthService.login/adminLogin). Es la ÚNICA
    // cuenta de las 6 que usa una ruta/botón distintos.
    { email: 'admin-e2e@example.com',     file: 'admin.storageState.json',     admin: true },
    { email: 'moderator-e2e@example.com', file: 'moderator.storageState.json' },
    { email: 'editor-e2e@example.com',    file: 'editor.storageState.json'    },
  ];

  for (const user of users) {
    const context = await browser.newContext();
    const page = await context.newPage();

    const loginPath = user.admin ? '/admin/login' : '/login';
    const submitLabel = user.admin ? 'Entrar' : 'Iniciar sesión';
    const verifyPath = user.admin ? '/admin' : '/mis-anuncios';

    await page.goto(`${baseURL}${loginPath}`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill('Test1234!');
    await page.getByRole('button', { name: submitLabel }).click();

    // Wait for the redirect away from the login page without assuming the
    // destination. next-auth may resolve the session before Next.js Router
    // fires the callbackUrl push, so the landing route is not guaranteed.
    await page.waitForURL((url) => !url.pathname.startsWith(loginPath), { timeout: 15_000 });

    // Navigate explicitly to a protected route to confirm the session cookie is
    // live and middleware does not bounce us back to login.
    await page.goto(`${baseURL}${verifyPath}`);
    const finalUrl = page.url();
    if (finalUrl.includes('/login')) {
      throw new Error(
        `[globalSetup] Session not established for ${user.email} — ` +
        `${verifyPath} redirected to: ${finalUrl}`,
      );
    }

    await context.storageState({ path: path.join(FIXTURES_DIR, user.file) });
    await context.close();
  }

  await browser.close();
}
