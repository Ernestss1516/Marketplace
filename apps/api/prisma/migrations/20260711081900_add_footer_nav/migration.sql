-- CreateEnum
CREATE TYPE "FooterItemType" AS ENUM ('PAGE', 'INTERNAL', 'EXTERNAL');

-- CreateTable
CREATE TABLE "FooterColumn" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterItem" (
    "id" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" "FooterItemType" NOT NULL,
    "pageId" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FooterItem_columnId_order_idx" ON "FooterItem"("columnId", "order");

-- AddForeignKey
ALTER TABLE "FooterItem" ADD CONSTRAINT "FooterItem_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "FooterColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FooterItem" ADD CONSTRAINT "FooterItem_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
