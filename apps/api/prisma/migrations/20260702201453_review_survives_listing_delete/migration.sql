-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_listingId_fkey";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "listingTitle" TEXT,
ALTER COLUMN "listingId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: reseñas existentes cuyo anuncio todavía existe reciben el snapshot
-- de título retroactivamente (para las que ya perdieron su anuncio no hay forma
-- de recuperar el título: quedan con listingTitle NULL).
UPDATE "Review" r
SET "listingTitle" = l."title"
FROM "Listing" l
WHERE r."listingId" = l."id"
  AND r."listingTitle" IS NULL;
