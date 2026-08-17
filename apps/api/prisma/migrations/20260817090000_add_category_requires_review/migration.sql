-- MODERACIÓN PREVIA, RÁFAGA M1 — la marca de revisión por categoría.
--
-- ESTRICTAMENTE ADITIVA: una columna nueva con DEFAULT false. Ninguna categoría
-- existente cambia de comportamiento al aplicarla, y no hay backfill que hacer:
-- `false` ES el valor correcto para todo lo que hay (nadie ha decidido todavía
-- qué ramas se revisan).

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "requiresReview" BOOLEAN NOT NULL DEFAULT false;
