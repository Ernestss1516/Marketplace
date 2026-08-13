-- PUERTA DE VALIDACIÓN, RÁFAGA 2 — el flag `needsRevalidation`.
--
-- ESTRICTAMENTE ADITIVA: una columna nueva con DEFAULT false. Ningún anuncio
-- existente cambia de comportamiento al aplicarla, y no hay backfill que hacer:
-- `false` ES el valor correcto para todo lo que hay (nadie ha cambiado todavía
-- ninguna configuración de categoría bajo el mecanismo nuevo).

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "needsRevalidation" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Listing_needsRevalidation_idx" ON "Listing"("needsRevalidation");
