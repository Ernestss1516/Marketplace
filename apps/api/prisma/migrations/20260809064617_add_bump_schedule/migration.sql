-- CreateEnum
CREATE TYPE "BumpScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED_BY_USER', 'PAUSED_NO_FUNDS', 'PAUSED_LISTING_INACTIVE');

-- CreateEnum
CREATE TYPE "BumpRunOutcome" AS ENUM ('APPLIED', 'SKIPPED_COOLDOWN', 'SKIPPED_LISTING_INACTIVE', 'FAILED_NO_FUNDS', 'FAILED_ERROR');

-- CreateTable
CREATE TABLE "BumpSchedule" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "status" "BumpScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BumpSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BumpRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "slot" TIMESTAMP(3) NOT NULL,
    "outcome" "BumpRunOutcome" NOT NULL,
    "paidWith" TEXT,
    "cost" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BumpRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BumpSchedule_status_nextRunAt_idx" ON "BumpSchedule"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BumpSchedule_userId_idx" ON "BumpSchedule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BumpSchedule_listingId_key" ON "BumpSchedule"("listingId");

-- CreateIndex
CREATE INDEX "BumpRun_scheduleId_createdAt_idx" ON "BumpRun"("scheduleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BumpRun_scheduleId_slot_key" ON "BumpRun"("scheduleId", "slot");

-- AddForeignKey
ALTER TABLE "BumpSchedule" ADD CONSTRAINT "BumpSchedule_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BumpSchedule" ADD CONSTRAINT "BumpSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BumpRun" ADD CONSTRAINT "BumpRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BumpSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
