-- AlterTable
ALTER TABLE "ListingImage" ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "listingId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ListingImage_uploadedById_idx" ON "ListingImage"("uploadedById");

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
