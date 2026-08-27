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
 * ahí. **Lo cierra `conColaPausada`, aquí abajo.**
 *
 * CORRECCIÓN (A1, 2026-08-27) — esta nota decía que el remedio era «mirar jobIds
 * deterministas en vez de contar», y eso era **incompleto**. La carrera tiene DOS
 * direcciones y el jobId sólo cierra una:
 *
 *   (a) DERIVA DEL TOTAL — un job AJENO al test se completa entre dos lecturas y
 *       el conteo baja. Afirmar por identidad (jobId, o `data.listingId`) lo
 *       cierra: deja de importar lo que hagan los demás.
 *
 *   (b) DESAPARICIÓN PROPIA — el job DEL test se completa y se borra antes de que
 *       el test lo lea. `getJob(jobId)` devuelve `undefined` exactamente igual que
 *       `getJobs()` lo omite. **El jobId no ayuda aquí en absoluto.**
 *
 * (b) sólo la cierra parar al worker. Y encima el jobId ni siquiera está siempre
 * disponible: de los dos productores que leen estas suites, uno pone `jobId`
 * (`feat-exp-…`, `entitlement-expiration.service.ts:85`) y el otro no (el degradado
 * Pro→Free, línea 182). Tocar producción para que un test pueda afirmar es
 * justo lo que no se hace.
 *
 * Conclusión: la barrera es `conColaPausada`; el jobId (o el filtro por
 * `data.listingId`) es lo que hace que la aserción DIGA lo que quiere decir. Son
 * complementarios, no alternativos. Ver `docs/auditoria-deuda-test-ci.md` §1.
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

/**
 * Ejecuta `fn` con la cola PARADA, y la vuelve a arrancar pase lo que pase.
 *
 * ── QUÉ CIERRA ────────────────────────────────────────────────────────────────
 *
 * La dirección (b) de la carrera descrita arriba: la desaparición del propio job.
 * `pause()` **vive en Redis**, no en el proceso, así que mientras dure NINGÚN
 * worker consume —da igual cuántos haya ni de qué módulo— y el job se queda en
 * `waiting` esperando a que se le lea. Sin esto, un test que afirme «el job existe»
 * está apostando a que el worker no haya llegado antes, y esa apuesta la pierde
 * exactamente cuando la máquina va cargada: en CI de vez en cuando, en local casi
 * nunca. Reproducido en `borrado-cuentas-c2` metiendo 2,5 s antes de la lectura:
 * el conteo cae a 0 SIEMPRE.
 *
 * ── POR QUÉ EL `finally` NO ES NEGOCIABLE ────────────────────────────────────
 *
 * La pausa es un flag en Redis, y la batería corre `--runInBand` bajo el candado
 * compartido de `e2e-lock.js`: **una pausa fugada no rompe este test, congela
 * TODAS las suites siguientes** que dependan de que esa cola se consuma, y el rojo
 * sale a metros del sitio donde se dejó. Es el único modo en que este arreglo
 * puede hacer daño, y por eso el `finally` está aquí dentro y no en once
 * `try/finally` escritos a mano —el mismo argumento que justifica
 * `getExistingJobs` en vez de once `j?.`—.
 *
 * ── DÓNDE PONERLA: POR CASO, NO POR SUITE ────────────────────────────────────
 *
 * `rf7-expiration` y `h8-featured-quota` pausan la cola de INDEXADO, que sus
 * propias fixtures usan. Pausarla de suite dejaría los anuncios sin indexar en
 * Meili durante toda la corrida; hoy ninguna de las dos afirma nada contra Meili,
 * así que colaría — pero es una apuesta que caduca en cuanto alguien añada un
 * caso. Envolviendo sólo el tramo que lee la cola, esa apuesta no existe.
 */
export async function conColaPausada<T>(queue: Queue, fn: () => Promise<T>): Promise<T> {
  await queue.pause();
  try {
    return await fn();
  } finally {
    await queue.resume();
  }
}
