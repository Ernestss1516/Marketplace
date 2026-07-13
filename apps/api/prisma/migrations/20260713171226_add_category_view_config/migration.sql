-- CreateEnum
CREATE TYPE "ListingViewMode" AS ENUM ('LISTA', 'AMPLIADA', 'MAPA');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "allowedViews" "ListingViewMode"[] DEFAULT ARRAY[]::"ListingViewMode"[],
ADD COLUMN     "defaultView" "ListingViewMode";
