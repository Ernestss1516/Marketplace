// globalTeardown — runs once after all test suites complete.
// Each suite closes its own NestJS app with app.close(), so no global
// connection cleanup is needed here. This file exists as an extension point
// (e.g. to delete the Meilisearch test index after a full CI run).

module.exports = async function globalTeardown() {};
