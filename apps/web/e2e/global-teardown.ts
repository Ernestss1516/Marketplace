import * as path from 'path';

/**
 * Suelta el candado que `global-setup.ts` cogió para que la batería e2e de
 * backend no corra a la vez que esta (ver `apps/api/test/e2e-lock.js`).
 *
 * Si la corrida muere sin pasar por aquí (Ctrl-C, crash del runner), el candado
 * queda huérfano: la siguiente corrida lo detecta por el PID y lo rompe sola, así
 * que un fallo aquí nunca deja el proyecto bloqueado.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const e2eLock = require(path.join(__dirname, '..', '..', 'api', 'test', 'e2e-lock.js')) as {
  release: (owner: string) => void;
};

export default async function globalTeardown() {
  e2eLock.release('playwright');
}
