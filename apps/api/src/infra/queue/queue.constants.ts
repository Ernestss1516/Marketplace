export const QUEUE_IMAGE = 'image-processing';
export const QUEUE_INDEXING = 'indexing';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_BILLING = 'billing';
export const QUEUE_REDSYS = 'redsys';
export const QUEUE_ALERT_MATCHING = 'alert-matching';
export const QUEUE_INVOICING = 'invoicing';
/// Bump automático (proyecto 2) — un job por TURNO ya reclamado. Cola propia y no
/// QUEUE_BILLING para que un pico de turnos programados no retrase los cobros de
/// checkout, que sí esperan a un usuario delante de la pantalla.
export const QUEUE_BUMP_AUTO = 'bump-auto';
/// Puerta ráfaga 2 — revalidar y marcar anuncios tras cambiar el schema de una
/// categoría. Cola propia y NO QUEUE_INDEXING, aunque el disparador sea el mismo
/// PATCH: este trabajo no indexa nada (marcar no toca Meilisearch, a propósito) y
/// puede recorrer decenas de miles de anuncios de un árbol entero. Mezclarlo con
/// el indexado dejaría a las fichas recién publicadas esperando detrás de un
/// barrido de mantenimiento.
export const QUEUE_REVALIDATION = 'revalidation';
/// BORRADO B3 — limpiar del bucket los ficheros de algo que ya no existe.
///
/// COLA PROPIA, y no dentro de QUEUE_INDEXING aunque el disparador sea el mismo
/// borrado: son dos naturalezas distintas. Sacar el documento de Meilisearch
/// mantiene la BÚSQUEDA correcta —si se retrasa, el anuncio sigue apareciendo—,
/// mientras que borrar de R2 sólo ahorra almacenamiento: un fichero que sobra no
/// se ve en ninguna parte. Mezclarlos dejaría a las fichas recién publicadas
/// esperando detrás de un barrido de limpieza que a nadie le corre prisa.
///
/// Y hay una razón de forma: este trabajo NO recibe un `listingId` sino claves ya
/// resueltas (ver `media-keys.ts`), porque cuando se ejecuta el anuncio ya no
/// existe. Eso lo hace reutilizable para la deuda de huérfanas de
/// `docs/pendientes.md` — adjuntos de ticket, vídeos sin confirmar—, que no tienen
/// anuncio ninguno.
export const QUEUE_MEDIA_CLEANUP = 'media-cleanup';

/// BORRADO DE CUENTAS C5 — los anuncios de una cuenta que se acaba de vaciar, uno
/// por trabajo. Cola propia y no `QUEUE_INDEXING`: cada trabajo BORRA una fila y
/// dispara su propia cascada, mientras que el indexado sólo sincroniza. Y sobre
/// todo, un vendedor con doscientos anuncios no puede tener la petición del ADMIN
/// abierta mientras se borran uno a uno — ni dejar la mitad vivos si se corta.
export const QUEUE_ACCOUNT_CLEANUP = 'account-cleanup';

/// BORRADO DE CUENTAS C6 — armar el ZIP con todo lo que una persona generó.
///
/// COLA PROPIA, y no `QUEUE_MEDIA_CLEANUP` aunque las dos hablen con R2: aquélla
/// BORRA claves sueltas y a nadie le corre prisa; ésta hace una decena larga de
/// consultas, DESCARGA N ficheros del bucket, los comprime en memoria y sube el
/// resultado — con alguien esperando a que aparezca el botón de descargar.
/// Mezclarlas dejaría la exportación de un usuario detrás de un barrido de basura.
///
/// Y hay una razón de tamaño: un trabajo de aquí puede durar minutos y ocupar
/// memoria proporcional a las fotos del vendedor. Aislarlo es lo que impide que un
/// vendedor con doscientos anuncios frene cualquier otra cosa.
export const QUEUE_DATA_EXPORT = 'data-export';

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
