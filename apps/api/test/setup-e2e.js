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
};
