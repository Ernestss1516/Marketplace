-- DropIndex
DROP INDEX "User_lastLoginAt_desc_nulls_last_idx";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredById" TEXT,
ADD COLUMN     "retiredReason" TEXT;

-- CreateIndex
CREATE INDEX "Review_retiredAt_idx" ON "Review"("retiredAt");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
