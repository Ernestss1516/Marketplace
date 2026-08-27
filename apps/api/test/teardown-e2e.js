// globalTeardown — runs once after all test suites complete.
// Each suite closes its own NestJS app with app.close(), so no global
// connection cleanup is needed here. This file exists as an extension point
// (e.g. to delete the Meilisearch test index after a full CI run).

const { execSync } = require('child_process');
const { join } = require('path');
const { config } = require('dotenv');

module.exports = async function globalTeardown() {
  try {
    // A2 — BARRERA DE AISLAMIENTO DE `Setting`.
    //
    // Comprueba que ninguna suite dejó una clave sembrada distinta a como se la
    // encontró. Va aquí y no en un spec porque el defecto sólo se ve cuando ya han
    // corrido todas: la suite que ensucia termina en verde y la que se rompe es otra.
    // Ver `verificar-aislamiento-settings.ts`.
    //
    // Se lanza en un proceso aparte con ts-node, igual que la semilla en
    // `setup-e2e.js`: este fichero no pasa por la transformación de TypeScript.
    config({ path: join(__dirname, '..', '.env.test') });
    execSync('npx ts-node --project tsconfig.json test/verificar-aislamiento-settings.ts', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env },
    });
  } finally {
    // Suelta el candado compartido con Playwright (ver test/e2e-lock.js). Si la
    // corrida muere sin llegar aquí, el candado se detecta huérfano por el PID y la
    // siguiente lo rompe sola.
    //
    // En el `finally` a propósito: si la barrera de arriba falla, el candado tiene
    // que soltarse IGUAL. Un fallo de aislamiento no puede dejar la máquina sin poder
    // correr la batería otra vez.
    require('./e2e-lock').release('jest-e2e');
  }
};
