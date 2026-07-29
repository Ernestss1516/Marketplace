// globalTeardown — runs once after all test suites complete.
// Each suite closes its own NestJS app with app.close(), so no global
// connection cleanup is needed here. This file exists as an extension point
// (e.g. to delete the Meilisearch test index after a full CI run).

module.exports = async function globalTeardown() {
  // Suelta el candado compartido con Playwright (ver test/e2e-lock.js). Si la
  // corrida muere sin llegar aquí, el candado se detecta huérfano por el PID y la
  // siguiente lo rompe sola.
  require('./e2e-lock').release('jest-e2e');
};
