/**
 * Espera genérica "hasta que sea cierto" para efectos asíncronos (jobs de
 * BullMQ procesándose en segundo plano) que no tienen un helper dedicado.
 *
 * Delega en `waitUntil` de `async-state.ts` — un ÚNICO mecanismo de espera para
 * toda la batería, para que el deadline y el backoff no diverjan test a test.
 * Ver `helpers/async-state.ts` para el porqué de cada garantía.
 */
import { waitUntil, PollOptions } from './async-state';

export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs?: number,
  _intervalMs?: number, // ignorado: el intervalo ahora es backoff, no fijo
): Promise<void> {
  const opts: PollOptions = { timeoutMs, description: 'una condición de test (pollUntil)' };
  await waitUntil(check, opts);
}

export { pollFor, waitUntil, DEFAULT_TIMEOUT_MS } from './async-state';
