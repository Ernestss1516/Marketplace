import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';

/**
 * Truncates all user-generated data tables in dependency order.
 * TRUNCATE "User" CASCADE removes all FK-dependent rows (Listing, Conversation,
 * Message, Favorite, Review, Report, ListingImage, tokens, Post, AuditLog, …),
 * which in turn cascades to FooterItem (FooterItem.page → Post). FooterColumn
 * is included explicitly in the same statement — it has no FK to User/Post, so
 * it would otherwise survive cleanup and leak columns/order between suites.
 * Category and Setting are intentionally excluded — they are static system data
 * seeded once in globalSetup and must not be touched by individual suite cleanup,
 * since multiple Jest workers run suites in parallel and share the same DB.
 */
export async function cleanDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "User", "FooterColumn" CASCADE`;
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
