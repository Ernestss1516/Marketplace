-- AlterEnum
ALTER TYPE "CreditLedgerType" ADD VALUE 'PRO_BONUS';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "bonusCreditAmount" INTEGER;
