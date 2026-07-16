import { MeiliSearch } from 'meilisearch';

/**
 * Polls Meilisearch until the document with the given id appears in the index
 * or the timeout is reached.
 *
 * Use this in tests that publish a listing and then query GET /search.
 * Publishing enqueues a BullMQ job; the worker indexes asynchronously (~50–200 ms
 * locally, longer in CI service containers). Without this helper the search
 * request races the worker and produces intermittent failures.
 *
 * Pattern:
 *   await request.post(`/api/listings/${id}/publish`);
 *   await waitForIndex(meiliClient, process.env.MEILI_INDEX_NAME!, id);
 *   const res = await request.get('/api/search?q=...').expect(200);
 *
 * If the timeout is reached the error message explains where to look
 * (worker not running, wrong index name, Meilisearch unreachable).
 */
export async function waitForIndex(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  timeoutMs = 15_000,
  intervalMs = 300,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await client.index(indexName).getDocument(docId);
      return;
    } catch {
      // Document not yet indexed — wait and retry
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Listing "${docId}" was not indexed in Meilisearch within ${timeoutMs} ms. ` +
      `Verify that: (1) the BullMQ worker is running (createTestApp boots it), ` +
      `(2) MEILI_INDEX_NAME="${indexName}" matches the index the worker writes to, ` +
      `(3) Meilisearch is reachable at ${process.env.MEILI_HOST ?? 'http://localhost:7700'}.`,
  );
}

/**
 * Polls Meilisearch until the document with the given id is absent from the index
 * or the timeout is reached. Complement of waitForIndex.
 *
 * Use this in tests that mark a listing as SOLD/DELETED and need to assert it
 * was removed from the search index. The removal is enqueued as a BullMQ job;
 * the worker processes it asynchronously.
 *
 * Pattern:
 *   await request.post(`/api/listings/${id}/deals`).send({});
 *   await waitForRemoval(meiliClient, process.env.MEILI_INDEX_NAME!, id);
 */
export async function waitForRemoval(
  client: MeiliSearch,
  indexName: string,
  docId: string,
  timeoutMs = 15_000,
  intervalMs = 300,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await client.index(indexName).getDocument(docId);
    } catch {
      return; // document gone — success
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Listing "${docId}" was still present in Meilisearch after ${timeoutMs} ms. ` +
      `Verify that the indexing worker processed the removal job.`,
  );
}
