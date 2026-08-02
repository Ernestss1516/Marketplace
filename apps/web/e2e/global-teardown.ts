import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Suelta el candado que `global-setup.ts` cogió para que la batería e2e de
 * backend no corra a la vez que esta (ver `apps/api/test/e2e-lock.js`), y borra
 * las categorías que la corrida haya creado de más (BARRERA 2, ver
 * `apps/api/test/clean-categories-delta.js`).
 *
 * Si la corrida muere sin pasar por aquí (Ctrl-C, crash del runner), el candado
 * queda huérfano: la siguiente corrida lo detecta por el PID y lo rompe sola, así
 * que un fallo aquí nunca deja el proyecto bloqueado. Y las categorías que se
 * queden sin borrar las barre el TRUNCATE del siguiente globalSetup (Barrera 1),
 * así que tampoco pueden acumularse.
 */
const API_DIR = path.join(__dirname, '..', '..', 'api');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const e2eLock = require(path.join(API_DIR, 'test', 'e2e-lock.js')) as {
  release: (owner: string) => void;
};

export default async function globalTeardown() {
  // La limpieza va ANTES de soltar el candado: mientras se borra, la otra batería
  // no debe poder empezar a escribir en la misma base.
  try {
    execSync('node test/clean-categories-delta.js', {
      cwd: API_DIR,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch {
    // Ver arriba: la Barrera 1 lo cubre igualmente. Nunca tumbar el teardown por
    // esto, o el candado se quedaría sin soltar.
  }

  e2eLock.release('playwright');
}
