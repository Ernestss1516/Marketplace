import type { Job, JobType, Queue } from 'bullmq';

/**
 * Los jobs de una cola que TODAVÍA EXISTEN cuando se leen.
 *
 * ── EL DEFECTO QUE CIERRA, y por qué no se veía ──────────────────────────────
 *
 * `Queue.getJobs(estados)` de BullMQ **no es atómico**. Su implementación
 * (`queue-getters.js`, `getJobs`) hace dos pasos:
 *
 *   1. lee los IDs de las listas de estado que se le piden;
 *   2. `Promise.all(ids.map(id => Job.fromId(queue, id)))` — va a buscar el hash
 *      de cada uno, uno por uno.
 *
 * Y las colas de este proyecto se registran con `RETRY_JOB_OPTIONS`, que lleva
 * **`removeOnComplete: true`** (`queue.constants.ts`). En las suites e2e el worker
 * está VIVO —se levanta el `AppModule` entero—, así que si completa un job entre
 * el paso 1 y el paso 2, **borra el hash**: `Job.fromId` devuelve `undefined` y el
 * array vuelve con huecos.
 *
 * Los once sitios que leían estas colas filtraban con `(j) => j.data?.listingId`.
 * Ese `?.` protege `data`, **no `j`** — con un hueco, `TypeError: Cannot read
 * properties of undefined (reading 'data')`.
 *
 * ── POR QUÉ UN HELPER Y NO ONCE `j?.` ────────────────────────────────────────
 *
 * Porque el defecto ES un olvido, y once oportunidades de olvidarlo otra vez es
 * exactamente lo que produjo éste. Misma lección, y mismo remedio, que `VIGENTES`
 * en `reviews.service.ts`: una sola constante compartida en vez de N copias del
 * filtro. Aquí además el olvido tarda dos meses en verse — el hueco sólo aparece
 * cuando la máquina va lo bastante cargada, así que en local casi nunca y en CI de
 * vez en cuando.
 *
 * ── LO QUE ESTE HELPER *NO* ARREGLA, dicho a la cara ─────────────────────────
 *
 * Con `removeOnComplete: true`, **contar jobs sigue siendo intrínsecamente racy**:
 * entre dos llamadas seguidas el worker puede completar uno y hacer que el conteo
 * baje sin que nadie haya encolado ni desencolado nada a propósito. Eso ya no
 * revienta con un `TypeError` —falla como aserción, que es honesto—, pero sigue
 * ahí. Arreglarlo de verdad exige cambiar lo que esas aserciones AFIRMAN (mirar
 * jobIds deterministas en vez de contar), y eso es un rediseño de los tests, no
 * una corrección. Queda anotado, no escondido.
 */
export async function getExistingJobs(queue: Queue, estados: JobType[]): Promise<Job[]> {
  const jobs = await queue.getJobs(estados);
  // El `Boolean(j)` es el arreglo entero. El predicado de tipo es lo que permite
  // que los llamantes sigan escribiendo `j.data` sin `?.` y que TypeScript los
  // respalde en vez de que lo parezca.
  return jobs.filter((j): j is Job => Boolean(j));
}

/** Los cuatro estados que miran todas las suites que leen la cola de indexado. */
export const ESTADOS_EN_VUELO: JobType[] = ['waiting', 'active', 'completed', 'delayed'];
