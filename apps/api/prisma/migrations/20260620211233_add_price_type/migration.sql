-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FIXED', 'FREE', 'NEGOTIABLE');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "priceType" "PriceType" NOT NULL DEFAULT 'FIXED';
