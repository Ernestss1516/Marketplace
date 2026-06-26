-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('PACK_PURCHASE', 'FEATURED_DEBIT', 'BUMP_DEBIT', 'ADMIN_CREDIT', 'ADMIN_DEBIT');

-- AlterTable
ALTER TABLE "GatewayEvent" ADD COLUMN     "gateway" TEXT NOT NULL DEFAULT 'STRIPE';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "bumpedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Price" ADD COLUMN     "creditPackId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "gateway" TEXT NOT NULL DEFAULT 'STRIPE';

-- CreateTable
CREATE TABLE "CreditPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creditAmount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "CreditLedger_walletId_idx" ON "CreditLedger"("walletId");

-- CreateIndex
CREATE INDEX "CreditLedger_createdAt_idx" ON "CreditLedger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Price_creditPackId_key" ON "Price"("creditPackId");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_creditPackId_fkey" FOREIGN KEY ("creditPackId") REFERENCES "CreditPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
