// globalSetup — runs once before all test suites in a separate Node.js process.
// TypeScript is NOT available here (Jest does not transform globalSetup files).
// Responsibilities:
//   1. Load .env.test so DATABASE_URL etc. are available for child processes.
//   2. Apply pending Prisma migrations to the test database.
//   3. Seed static categories (upsert — idempotent).
//
// Prerequisites (one-time local setup):
//   docker exec marketplace-postgres psql -U marketplace -c "CREATE DATABASE marketplace_test"
// In CI the service container creates the DB directly (see docs/estrategia-testing.md §7).

const { execSync } = require('child_process');
const { join } = require('path');
const { config } = require('dotenv');
const flushRedisTestDb = require('./flush-redis-test-db');

module.exports = async function globalSetup() {
  config({ path: join(__dirname, '..', '.env.test') });

  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env },
  });

  execSync('npx ts-node --project tsconfig.json prisma/seed-test.ts', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env },
  });

  // RÁFAGA 3 — /auth/login (rate limit) es llamado como infraestructura de
  // setup por CASI TODOS los specs (login de usuarios de prueba). Sin este
  // flush, una corrida local repetida dentro de la misma ventana (15min/1h)
  // hereda contadores de la corrida anterior y specs sin ninguna relación con
  // auth empiezan a recibir 401/429 en cascada — mismo principio que
  // "resetear entre CADA pasada, no solo antes de la primera" (ver
  // feedback_ci_verde_repetido). Flush aquí, una vez, antes de toda la
  // batería — no basta con que auth-security.e2e-spec.ts lo haga en su propio
  // beforeAll, porque ese archivo no es necesariamente el primero en correr.
  // Ahora es un FLUSHDB completo (seguro: db de test aislada de la de dev —
  // ver redis-connection.ts), no solo `auth:*`. Compartido con el globalSetup
  // de Playwright — ver flush-redis-test-db.js.
  await flushRedisTestDb();
};
