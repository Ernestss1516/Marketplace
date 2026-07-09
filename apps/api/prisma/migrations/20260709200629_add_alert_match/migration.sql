-- CreateTable
CREATE TABLE "AlertMatch" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertMatch_listingId_idx" ON "AlertMatch"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertMatch_alertId_listingId_key" ON "AlertMatch"("alertId", "listingId");

-- AddForeignKey
ALTER TABLE "AlertMatch" ADD CONSTRAINT "AlertMatch_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertMatch" ADD CONSTRAINT "AlertMatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
