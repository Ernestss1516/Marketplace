// globalTeardown — runs once after all test suites complete.
// Each suite closes its own NestJS app with app.close(); aquí van las barreras de
// CORRIDA: las que sólo pueden verse cuando ya ha corrido todo.

const { execSync } = require('child_process');
const { join } = require('path');
const { config } = require('dotenv');

// Las dos barreras de corrida, en el orden en que conviene leerlas. Se lanzan en
// procesos aparte con ts-node, igual que la semilla en `setup-e2e.js`: este fichero
// no pasa por la transformación de TypeScript.
//
// A2 — AISLAMIENTO DE `Setting`. Comprueba que ninguna suite dejó una clave sembrada
// distinta a como se la encontró. Va aquí y no en un spec porque el defecto sólo se ve
// cuando ya han corrido todas: la suite que ensucia termina en verde y la que se rompe
// es otra. Ver `verificar-aislamiento-settings.ts`.
//
// CONEXIONES — que nadie se deje un socket de Redis abierto. Misma forma de defecto
// (invisible desde dentro) y misma respuesta. Ver `verificar-conexiones-redis.ts`.
const BARRERAS = [
  ['aislamiento de Setting', 'test/verificar-aislamiento-settings.ts'],
  ['conexiones a Redis', 'test/verificar-conexiones-redis.ts'],
];

module.exports = async function globalTeardown() {
  try {
    config({ path: join(__dirname, '..', '.env.test') });

    // SE EJECUTAN LAS DOS, pase lo que pase con la primera. Si una fallara y cortara a
    // la siguiente, arreglar la primera destaparía la segunda en la corrida de después
    // — un rojo por vuelta en vez de la foto entera. Se acumulan y se informa de todo.
    const fallos = [];
    for (const [nombre, script] of BARRERAS) {
      try {
        execSync(`npx ts-node --project tsconfig.json ${script}`, {
          cwd: join(__dirname, '..'),
          stdio: 'inherit',
          env: { ...process.env },
        });
      } catch (err) {
        fallos.push(nombre);
      }
    }

    if (fallos.length > 0) {
      throw new Error(
        `Barrera(s) de corrida en rojo: ${fallos.join(', ')}. El detalle está impreso arriba.`,
      );
    }
  } finally {
    // Suelta el candado compartido con Playwright (ver test/e2e-lock.js). Si la
    // corrida muere sin llegar aquí, el candado se detecta huérfano por el PID y la
    // siguiente lo rompe sola.
    //
    // En el `finally` a propósito: si una barrera falla, el candado tiene que soltarse
    // IGUAL. Un fallo de aislamiento no puede dejar la máquina sin poder correr la
    // batería otra vez.
    require('./e2e-lock').release('jest-e2e');
  }
};
