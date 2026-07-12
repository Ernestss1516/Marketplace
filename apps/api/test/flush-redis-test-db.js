// RÁFAGA 3 introduced rate limiting on /auth/login (5/email/15min, 150/IP/15min)
// etc. Both e2e runners use POST /auth/login as ordinary test infrastructure —
// Jest's own suite (many specs log in seeded users in their own beforeAll) and
// Playwright's (global-setup logs in 6 seeded users for storageState, and
// several specs additionally call the API directly via a loginViaApi helper).
// None of that traffic should ever be mistaken for the fresh-per-run counters
// a real brute-force detector needs — a repeated LOCAL run (or a single run
// where many spec files share the same seeded accounts) must not inherit or
// exhaust another suite's counters. Flush once, before anything logs in.
//
// Previously this only deleted `auth:*` keys, which left `contact:rate:*`,
// `bull:*` (BullMQ), `listing:*`/`sponsored-ad:*` caches and `view:dedup:*`
// locks dirty between runs. Now that dev (db 0) and test (db 1+) are on
// separate Redis logical dbs (see redis-connection.ts), a full FLUSHDB is
// safe — it only ever touches the test db, never dev's. The guard below
// refuses to run if REDIS_URL somehow resolves to db 0, so a misconfigured
// .env.test can never wipe a developer's live Redis state.
//
// Plain CommonJS (no ts-node) so it can be required identically from Jest's
// globalSetup (also plain JS) and shelled out to from Playwright's
// globalSetup (TypeScript, but ioredis is only a dependency of apps/api).
const Redis = require('ioredis');

function resolveDb(redisUrl) {
  const url = new URL(redisUrl);
  return url.pathname && url.pathname !== '/' ? parseInt(url.pathname.slice(1), 10) : 0;
}

module.exports = async function flushRedisTestDb() {
  const redisUrl = process.env.REDIS_URL;
  const db = resolveDb(redisUrl);
  if (db === 0) {
    throw new Error(
      `[flush-redis-test-db] REDIS_URL resolves to db 0 (the dev database): ${redisUrl}\n` +
        'Refusing to FLUSHDB — test env must use a non-zero db (e.g. redis://localhost:6379/1 in .env.test).',
    );
  }

  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();
};

if (require.main === module) {
  module.exports().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
