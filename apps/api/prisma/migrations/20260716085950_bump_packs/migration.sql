-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BumpLedgerType" ADD VALUE 'PACK_PURCHASE';
ALTER TYPE "BumpLedgerType" ADD VALUE 'PRO_BONUS';

-- AlterTable
ALTER TABLE "Price" ADD COLUMN     "bumpPackId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "baseBumpAmount" INTEGER,
ADD COLUMN     "bonusBumpAmount" INTEGER;

-- CreateTable
CREATE TABLE "BumpPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bumpAmount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BumpPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Price_bumpPackId_key" ON "Price"("bumpPackId");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_bumpPackId_fkey" FOREIGN KEY ("bumpPackId") REFERENCES "BumpPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
