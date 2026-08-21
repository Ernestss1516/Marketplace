-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "lastOwnerInteractionAt" TIMESTAMP(3),
ADD COLUMN     "lastOwnerIp" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginIp" TEXT;
