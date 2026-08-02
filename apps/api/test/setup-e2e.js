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

// OJO CON EL ORDEN DE LOS require. `reset-test-db.js` y `flush-meili-test-index.js`
// NO se cargan aquí arriba a propósito: `reset-test-db` hace
// `require('@prisma/client')`, y Prisma carga por su cuenta el `.env` que hay junto
// al schema —el de DESARROLLO— en cuanto se importa. Como `dotenv.config()` NUNCA
// pisa una variable ya puesta, cargarlos antes de leer `.env.test` dejaría
// `DATABASE_URL` apuntando a la base de dev durante todo el globalSetup.
//
// No es teórico: pasó al escribir esta barrera, y lo que lo detectó fue el guard
// por nombre de base de `reset-test-db.js`, que se negó a truncar. Sin ese guard,
// el primer TRUNCATE se habría llevado la base de desarrollo entera.
//
// Se cargan dentro de la función, después de `config({ path: .env.test })`.

module.exports = async function globalSetup() {
  // ANTES DE TODO: candado compartido con Playwright. Las dos baterías usan la
  // misma base y la misma db de Redis; correrlas a la vez produce rojos falsos.
  // Ver test/e2e-lock.js.
  require('./e2e-lock').acquire('jest-e2e');

  config({ path: join(__dirname, '..', '.env.test') });

  // Ahora sí (ver la nota sobre el orden de los require, arriba): con .env.test ya
  // cargado, importar Prisma no puede colar la DATABASE_URL de desarrollo.
  const resetTestDb = require('./reset-test-db');
  const flushMeiliTestIndex = require('./flush-meili-test-index');

  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env },
  });

  // BARRERA 1 — vaciar ANTES de sembrar. Sin esto la base solo crecía: el seed es
  // de upserts y `cleanDb` (por suite) excluye Category/Setting a propósito, así
  // que toda categoría creada por un spec sobrevivía para siempre (2.775 donde el
  // seed pone ~20, ver reset-test-db.js). Cada corrida parte ahora del seed
  // determinista, no de la sedimentación de las anteriores.
  // Va después de `migrate deploy` porque necesita que las tablas existan.
  await resetTestDb();
  // El índice va con la base: al vaciar Postgres, todo documento indexado queda
  // huérfano. Las dos limpiezas son una sola cosa.
  await flushMeiliTestIndex();

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
