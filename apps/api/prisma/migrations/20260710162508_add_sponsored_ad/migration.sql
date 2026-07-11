-- CreateTable
CREATE TABLE "SponsoredAd" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsoredAd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsoredAd_categoryId_active_idx" ON "SponsoredAd"("categoryId", "active");

-- AddForeignKey
ALTER TABLE "SponsoredAd" ADD CONSTRAINT "SponsoredAd_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
