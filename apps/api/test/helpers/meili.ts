import { MeiliSearch } from 'meilisearch';
import { pollFor, PollOptions } from './async-state';

/**
 * Espera a que un documento cumpla un PREDICADO en Meilisearch — la forma
 * preferente de esperar la indexación.
 *
 * Úsalo (en vez de `waitForIndex`) siempre que después vayas a AFIRMAR SOBRE EL
 * CONTENIDO del documento. Esperar solo a que exista devuelve la primera
 * versión escrita, que un job posterior todavía puede reescribir (geocode →
 * reindex), y entonces la aserción sale verde o roja según los tiempos —
 * exactamente el falso verde de B2 (ver tags-b2.e2e-spec.ts) y el rojo rotativo
 * de redsys-featured.
 *
 *   // MAL: espera a que exista, luego afirma sobre un campo que aún puede cambiar
 *   await waitForIndex(meili, INDEX, id);
 *   expect((await meili.index(INDEX).getDocument(id)).boostScore).toBe(1);
 *
 *   // BIEN: espera a que el campo VALGA lo esperado
 *   const doc = await waitForDocumentWhere<{ boostScore: number }>(
 *     meili, INDEX, id, (d) => d.boostScore === 1, { description: 'boostScore=1' },
 *   );
 *   expect(doc.boostScore).toBe(1);
 *
 * Que `getDocument` lance ("Document not found") es "todavía no", no un fallo.
 */
export async function waitForDocumentWhere<T extends Record<string, unknown>>(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  predicate: (doc: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  return pollFor<T>(
    () => client.index(indexName).getDocument(docId) as Promise<T>,
    predicate,
    {
      ...opts,
      description:
        opts.description ??
        `que el documento "${docId}" de "${indexName}" alcance el estado esperado`,
    },
  );
}

/**
 * Espera a que un campo concreto del documento valga `expected`.
 * Azúcar sobre `waitForDocumentWhere` para el caso más común.
 */
export async function waitForDocumentField<T extends Record<string, unknown>>(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  field: string,
  expected: unknown,
  opts: PollOptions = {},
): Promise<T> {
  return waitForDocumentWhere<T>(
    client,
    indexName,
    docId,
    (doc) => doc[field] === expected,
    {
      ...opts,
      description:
        opts.description ??
        `que "${docId}".${field} === ${JSON.stringify(expected)} en "${indexName}"`,
    },
  );
}

/**
 * Espera a que el documento EXISTA en el índice.
 *
 * Correcto solo cuando lo que se prueba es la PRESENCIA en sí (que el anuncio
 * aparece en /search, que el worker llegó a indexarlo). Si después vas a
 * afirmar sobre el contenido del documento, usa `waitForDocumentWhere` —
 * la existencia no garantiza que el documento sea ya el definitivo.
 *
 * Publicar un anuncio encola un job de BullMQ; el worker indexa de forma
 * asíncrona (~50-200 ms en local, bastante más en los contenedores del CI).
 * Sin esta espera la petición de búsqueda corre contra el worker.
 */
export async function waitForIndex(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  timeoutMs?: number,
): Promise<void> {
  try {
    await pollFor(
      () => client.index(indexName).getDocument(docId),
      () => true, // el probe ya lanza si no existe; llegar aquí ES la condición
      { timeoutMs, description: `a que "${docId}" se indexe en "${indexName}"` },
    );
  } catch (err) {
    throw new Error(
      `El anuncio "${docId}" no se indexó en Meilisearch a tiempo. ` +
        `Comprueba que: (1) el worker de BullMQ está corriendo (createTestApp lo arranca), ` +
        `(2) MEILI_INDEX_NAME="${indexName}" coincide con el índice al que escribe el worker, ` +
        `(3) Meilisearch responde en ${process.env.MEILI_HOST ?? 'http://localhost:7700'}.\n` +
        `Detalle: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Espera a que el documento DESAPAREZCA del índice. Complemento de waitForIndex.
 *
 * Para tests que marcan un anuncio como SOLD/DELETED y comprueban que sale del
 * índice. La retirada también se encola como job de BullMQ.
 */
export async function waitForRemoval(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  timeoutMs?: number,
): Promise<void> {
  // Aquí la ausencia ES el estado definitivo: se sondea "¿sigue estando?" y se
  // espera a `false`. Que getDocument lance significa que ya no está.
  await pollFor(
    async () => {
      try {
        await client.index(indexName).getDocument(docId);
        return true; // sigue presente
      } catch {
        return false; // ya no está
      }
    },
    (stillPresent) => stillPresent === false,
    {
      timeoutMs,
      description: `a que "${docId}" se retire del índice "${indexName}" (¿procesó el worker el job de borrado?)`,
    },
  );
}
