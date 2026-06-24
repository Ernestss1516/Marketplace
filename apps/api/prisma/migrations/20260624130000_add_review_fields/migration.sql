-- AlterEnum: add FAKE_REVIEW to ReportReason
-- Prisma's safe approach: recreate the type to work inside a transaction
DO $$ BEGIN
    CREATE TYPE "ReportReason_new" AS ENUM ('SPAM', 'FRAUD', 'INAPPROPRIATE', 'PROHIBITED_ITEM', 'WRONG_CATEGORY', 'FAKE_REVIEW', 'OTHER');
    ALTER TABLE "Report" ALTER COLUMN "reason" TYPE "ReportReason_new" USING ("reason"::text::"ReportReason_new");
    ALTER TYPE "ReportReason" RENAME TO "ReportReason_old";
    ALTER TYPE "ReportReason_new" RENAME TO "ReportReason";
    DROP TYPE "ReportReason_old";
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable Review: drop old unique constraint (authorId, listingId)
DROP INDEX IF EXISTS "Review_authorId_listingId_key";

-- AlterTable Review: drop old FKs to recreate with CASCADE
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_authorId_fkey";
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_targetId_fkey";
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_listingId_fkey";

-- AlterTable Review: make listingId non-nullable (table is empty in stub)
ALTER TABLE "Review" ALTER COLUMN "listingId" SET NOT NULL;

-- AlterTable Review: add new columns
ALTER TABLE "Review" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Review" ADD COLUMN "editedAt" TIMESTAMP(3);

-- AlterTable Review: recreate FKs with CASCADE
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Review" ADD CONSTRAINT "Review_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Review" ADD CONSTRAINT "Review_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Review: new unique constraint
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_targetId_listingId_key"
    UNIQUE ("authorId", "targetId", "listingId");

-- CreateIndex Review: listingId
CREATE INDEX "Review_listingId_idx" ON "Review"("listingId");

-- AlterTable Report: add reviewId column and FK
ALTER TABLE "Report" ADD COLUMN "reviewId" TEXT;

ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex Report: reviewId
CREATE INDEX "Report_reviewId_idx" ON "Report"("reviewId");
