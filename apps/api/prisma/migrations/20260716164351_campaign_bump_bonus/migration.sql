-- AlterEnum
ALTER TYPE "BumpLedgerType" ADD VALUE 'CAMPAIGN_BONUS';

-- AlterEnum
ALTER TYPE "CampaignType" ADD VALUE 'BUMP_BONUS';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "campaignBonusBumpAmount" INTEGER;
