-- CreateEnum
CREATE TYPE "BumpLedgerType" AS ENUM ('COUPON_REDEEM', 'BUMP_DEBIT', 'ADMIN_CREDIT', 'ADMIN_DEBIT');

-- AlterEnum
ALTER TYPE "CouponRewardType" ADD VALUE 'BUMP';

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "bumpAmount" INTEGER;

-- AlterTable
ALTER TABLE "CreditPack" ADD COLUMN     "highlightBumps" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "bumpBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BumpLedger" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "BumpLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BumpLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BumpLedger_walletId_idx" ON "BumpLedger"("walletId");

-- CreateIndex
CREATE INDEX "BumpLedger_createdAt_idx" ON "BumpLedger"("createdAt");

-- CreateIndex
CREATE INDEX "BumpLedger_referenceType_referenceId_idx" ON "BumpLedger"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "CreditLedger_referenceType_referenceId_idx" ON "CreditLedger"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "BumpLedger" ADD CONSTRAINT "BumpLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
