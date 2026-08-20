-- ETIQUETA INTERNA DE MODERACIÓN (P1) — RÁFAGA E1: EL MODELO.
--
-- ESTRICTAMENTE ADITIVA: un enum nuevo, dos columnas con DEFAULT y un índice.
-- Ningún anuncio existente cambia de comportamiento al aplicarla, y NO HAY
-- BACKFILL que hacer — los `DEFAULT` dan a todas las filas el valor correcto:
--
--   · `triage = NEW` porque, literalmente, nadie ha triado nada todavía. La
--     etiqueta significa «revisado bajo ESTE sistema», y el sistema nace aquí.
--     Se descartó sembrar REVIEWED en los que tuvieran un `LISTING_APPROVE` en
--     AuditLog: aprobar es dejar publicar, triar es decidir dónde mira el staff,
--     y no son lo mismo (ver docs/diseno-etiqueta-interna.md §6, D-1).
--   · `watched = false` porque nadie ha marcado nada.
--
-- DOS EJES Y NO UNO, que es la decisión de fondo: `triage` es un CICLO de tres
-- valores excluyentes y `watched` una BANDERA que convive con cualquiera de
-- ellos. Ninguno de los dos gobierna `status`, ni `status` los gobierna a ellos.

-- CreateEnum
CREATE TYPE "ListingTriage" AS ENUM ('NEW', 'REVIEWED', 'EDITED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "triage" "ListingTriage" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "watched" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
-- Para listar los vigilados sin recorrer la tabla entera. Misma forma y mismo
-- motivo que `Listing_needsRevalidation_idx`: un booleano cuyo `true` es raro.
-- `triage` no lleva índice todavía a propósito — se mide en E2, donde existirá
-- la consulta (F2 dejó el precedente de medirlo con EXPLAIN antes de añadirlo).
CREATE INDEX "Listing_watched_idx" ON "Listing"("watched");
