-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('CREDIT_BONUS');

-- AlterEnum
ALTER TYPE "CreditLedgerType" ADD VALUE 'CAMPAIGN_BONUS';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "campaignBonusAmount" INTEGER,
ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_type_active_startsAt_endsAt_idx" ON "Campaign"("type", "active", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
