-- ESTADÍSTICAS A1 — captura de «veces listado» (impresiones de búsqueda).
--
-- Aditiva y sin backfill: `impressionCount` nace en 0 para todas las filas existentes
-- (Prisma escribe el DEFAULT al aplicar la migración) y la tabla diaria nace vacía. Nada
-- de lo que había cambia de comportamiento.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "impressionCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ListingImpressionDaily" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingImpressionDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingImpressionDaily_listingId_idx" ON "ListingImpressionDaily"("listingId");

-- CreateIndex
CREATE INDEX "ListingImpressionDaily_date_idx" ON "ListingImpressionDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ListingImpressionDaily_listingId_date_key" ON "ListingImpressionDaily"("listingId", "date");

-- AddForeignKey
ALTER TABLE "ListingImpressionDaily" ADD CONSTRAINT "ListingImpressionDaily_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
