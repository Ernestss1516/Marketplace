-- CreateTable
CREATE TABLE "ListingViewDaily" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingViewDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingViewDaily_listingId_idx" ON "ListingViewDaily"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingViewDaily_listingId_date_key" ON "ListingViewDaily"("listingId", "date");

-- AddForeignKey
ALTER TABLE "ListingViewDaily" ADD CONSTRAINT "ListingViewDaily_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
