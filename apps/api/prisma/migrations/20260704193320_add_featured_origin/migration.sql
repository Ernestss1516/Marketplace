-- CreateEnum
CREATE TYPE "FeaturedOrigin" AS ENUM ('CREDITS', 'REDSYS', 'PRO_QUOTA');

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "origin" "FeaturedOrigin";

-- CreateIndex
CREATE INDEX "Entitlement_userId_type_origin_createdAt_idx" ON "Entitlement"("userId", "type", "origin", "createdAt");

-- Backfill (H8.1): distinguish the two featured-listing "bags" retroactively for
-- rows that predate the `origin` column. transactionId is only ever set on the
-- Redsys path (grantFeaturedListing); featuredByCredits never sets it. A no-op
-- on a fresh database (zero FEATURED_LISTING rows).
UPDATE "Entitlement" SET "origin" = CASE WHEN "transactionId" IS NOT NULL THEN 'REDSYS' ELSE 'CREDITS' END::"FeaturedOrigin"
WHERE "type" = 'FEATURED_LISTING';
