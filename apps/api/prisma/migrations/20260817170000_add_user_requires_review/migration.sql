-- MODERACIÓN PREVIA, RÁFAGA M4 — la marca de revisión por usuario.
--
-- ESTRICTAMENTE ADITIVA: una columna nueva con DEFAULT false. Ningún vendedor
-- existente cambia de comportamiento al aplicarla, y no hay backfill: `false` ES
-- el valor correcto para todos (nadie ha marcado a nadie todavía).
--
-- OJO con la tentación de derivarla de `trusted`: son ejes INDEPENDIENTES. Un
-- vendedor no marcado no es «de confianza», y uno de confianza no está exento —
-- ver `PreModerationService`.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "requiresReview" BOOLEAN NOT NULL DEFAULT false;
