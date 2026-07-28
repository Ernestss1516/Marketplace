-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('ONE_TIME', 'PER_MONTH', 'PER_WEEK', 'PER_DAY', 'PER_HOUR', 'PER_UNIT', 'PER_SESSION');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "allowedPriceUnits" "PriceUnit"[] DEFAULT ARRAY[]::"PriceUnit"[];

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "priceUnit" "PriceUnit" NOT NULL DEFAULT 'ONE_TIME';
