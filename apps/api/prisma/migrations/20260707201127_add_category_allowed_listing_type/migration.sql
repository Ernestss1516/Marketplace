-- CreateEnum
CREATE TYPE "ListingTypePolicy" AS ENUM ('PRODUCT_ONLY', 'SERVICE_ONLY', 'BOTH');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "allowedListingType" "ListingTypePolicy" NOT NULL DEFAULT 'BOTH';
