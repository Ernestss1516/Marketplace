-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HOME', 'MIS_ANUNCIOS');

-- CreateEnum
CREATE TYPE "BannerVariant" AS ENUM ('INFO', 'PROMO', 'WARNING');

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "linkUrl" TEXT,
    "linkText" TEXT,
    "placements" "BannerPlacement"[],
    "variant" "BannerVariant" NOT NULL DEFAULT 'INFO',
    "shareable" BOOLEAN NOT NULL DEFAULT false,
    "shareText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Banner_active_startsAt_endsAt_idx" ON "Banner"("active", "startsAt", "endsAt");
