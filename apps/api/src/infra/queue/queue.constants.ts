export const QUEUE_IMAGE = 'image-processing';
export const QUEUE_INDEXING = 'indexing';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_BILLING = 'billing';
export const QUEUE_REDSYS = 'redsys';
export const QUEUE_ALERT_MATCHING = 'alert-matching';
export const QUEUE_INVOICING = 'invoicing';

// Each module that injects a queue calls its own BullModule.registerQueue({name})
// — @nestjs/bullmq creates a SEPARATE Queue (producer) instance per module
// registration of the same name, each with its own client-side defaultJobOptions.
// Declaring retry only in queue.module.ts does NOT reach a producer that lives
// in a different module (e.g. AuthService, AlertMatchingService) — every module
// that calls queue.add() and wants retry must pass this same object to ITS OWN
// registerQueue() call. Shared here so they can't drift from each other.
export const RETRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: 100,
};

// Structural guard for the bug above: every registerQueue() call site should
// go through this helper instead of writing `{ name }` by hand, so a new
// module can't silently end up with attempts:1 by forgetting the option.
// `queue-retry.e2e-spec.ts` greps src/ for any registerQueue() call that
// bypasses this helper and fails the suite if one is found.
export function retryQueue(name: string): { name: string; defaultJobOptions: typeof RETRY_JOB_OPTIONS } {
  return { name, defaultJobOptions: RETRY_JOB_OPTIONS };
}

// A plain constant, not an env var: @Processor()'s options evaluate at class
// decoration time, when QueueModule is require()'d by AppModule's import chain —
// before ConfigModule.forRoot() (further down in the same file) has loaded
// .env via dotenv. Reading process.env here would silently see undefined.
//
// Chosen by sweeping a local repro (20 listings publishing concurrently,
// [TIMING] logs in indexing.processor.ts) — see estado-tecnico.md, deuda
// "Meili lento en CI":
//   concurrency=1: last job totalFromEnqueue=2266ms, indexTimeMs avg=110.3ms
//   concurrency=3: last job totalFromEnqueue= 766ms, indexTimeMs avg=106.8ms
//   concurrency=5: last job totalFromEnqueue= 393ms, indexTimeMs avg= 94.5ms
//   concurrency=8: last job totalFromEnqueue= 402ms, indexTimeMs avg=117.6ms
// 5 is the sweet spot on this machine: ~5.8x faster than concurrency=1 with
// indexTimeMs unchanged (no saturation). 8 gives no further improvement and
// indexTimeMs ticks up — an early contention signal, not worth the risk on a
// resource-constrained CI runner. Re-measure if CI still shows the symptom
// after this change; the right number depends on the runner, not just Meili.
export const INDEXING_CONCURRENCY = 5;
