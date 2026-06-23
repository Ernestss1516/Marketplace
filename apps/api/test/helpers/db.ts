import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';

/**
 * Truncates all user-generated data tables in dependency order.
 * TRUNCATE "User" CASCADE removes all FK-dependent rows (Listing, Conversation,
 * Message, Favorite, Review, Report, ListingImage, tokens, …).
 * Category is intentionally excluded — it is seeded once in globalSetup.
 */
export async function cleanDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "User" CASCADE`;
}

/**
 * Deletes all documents from the test Meilisearch index.
 * Call this in beforeAll alongside cleanDb so search results are deterministic.
 */
export async function resetMeili(client: MeiliSearch): Promise<void> {
  const indexName = process.env.MEILI_INDEX_NAME ?? 'listings_test';
  await client.index(indexName).deleteAllDocuments();
}

/** Builds a Meilisearch client pointed at the test instance. */
export function buildMeiliClient(): MeiliSearch {
  return new MeiliSearch({
    host: process.env.MEILI_HOST ?? 'http://localhost:7700',
    apiKey: process.env.MEILI_MASTER_KEY,
  });
}
