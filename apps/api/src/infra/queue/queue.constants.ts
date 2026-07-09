export const QUEUE_IMAGE = 'image-processing';
export const QUEUE_INDEXING = 'indexing';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_BILLING = 'billing';
export const QUEUE_REDSYS = 'redsys';

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
