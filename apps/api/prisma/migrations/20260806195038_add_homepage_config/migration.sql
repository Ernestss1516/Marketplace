-- CreateTable
CREATE TABLE "HomepageConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "heroStaticTitle" TEXT NOT NULL,
    "heroRotatingOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroRotationMs" INTEGER NOT NULL DEFAULT 3000,
    "heroSubtitle" TEXT,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "HomepageConfig_pkey" PRIMARY KEY ("id")
);
