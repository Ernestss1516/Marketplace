import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';

/**
 * Truncates all user-generated data tables in dependency order.
 * TRUNCATE "User" CASCADE removes all FK-dependent rows (Listing, Conversation,
 * Message, Favorite, Review, Report, ListingImage, tokens, Post, AuditLog, …),
 * which in turn cascades to FooterItem (FooterItem.page → Post). FooterColumn,
 * ContactMessage and ContactReason are included explicitly in the same
 * statement — none has a FK to User (FooterColumn has none at all;
 * ContactMessage's sender is anonymous by design — RC.1; ContactReason is
 * admin-managed reference data, not owned by a User), so they would otherwise
 * survive cleanup and leak between suites (columns/order, rate-limit-adjacent
 * message counts, or duplicate reason names across suites — RC.2). Listing
 * ContactReason here is enough: TRUNCATE ... CASCADE also truncates
 * ContactMessage (FK'd to it) regardless of listing order, and ContactReply
 * cascades from ContactMessage (onDelete: Cascade) as well as from User
 * (adminUserId), so neither needs a separate entry beyond ContactMessage.
 * Category and Setting are intentionally excluded — they are static system data
 * seeded once in globalSetup and must not be touched by individual suite cleanup,
 * since multiple Jest workers run suites in parallel and share the same DB.
 */
export async function cleanDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "User", "FooterColumn", "ContactMessage", "ContactReason" CASCADE`;
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
