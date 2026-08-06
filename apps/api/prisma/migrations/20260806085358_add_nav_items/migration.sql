-- CreateEnum
CREATE TYPE "NavItemType" AS ENUM ('PAGE', 'INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "NavPageType" AS ENUM ('HOME', 'BUSQUEDA', 'CATEGORIA', 'ANUNCIO', 'BLOG', 'PAGINA_CMS', 'VENDEDOR', 'CONTACTO', 'PLANES');

-- CreateTable
CREATE TABLE "NavItem" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "type" "NavItemType",
    "pageId" TEXT,
    "url" TEXT,
    "visibleOn" "NavPageType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NavItem_parentId_order_idx" ON "NavItem"("parentId", "order");

-- AddForeignKey
ALTER TABLE "NavItem" ADD CONSTRAINT "NavItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NavItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavItem" ADD CONSTRAINT "NavItem_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
