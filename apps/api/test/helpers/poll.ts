/**
 * Generic "wait until true" poller for async side effects (BullMQ jobs
 * processing in the background) that don't have a dedicated helper like
 * waitForIndex(). Throws with the last-seen state if the timeout is reached.
 */
export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs = 15_000,
  intervalMs = 300,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pollUntil: condition not met within ${timeoutMs}ms`);
}
