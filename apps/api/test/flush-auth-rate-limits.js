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
// Plain CommonJS (no ts-node) so it can be required identically from Jest's
// globalSetup (also plain JS) and shelled out to from Playwright's
// globalSetup (TypeScript, but ioredis is only a dependency of apps/api).
const Redis = require('ioredis');

module.exports = async function flushAuthRateLimits() {
  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys('auth:*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
};

if (require.main === module) {
  module.exports().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
