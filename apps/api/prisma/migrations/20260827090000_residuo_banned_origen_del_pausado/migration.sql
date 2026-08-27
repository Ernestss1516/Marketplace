-- RESIDUO BANNED — EL ORIGEN DEL PAUSADO deja de ser un booleano.
--
-- Hasta aquí, `Listing.pausedByAccountArchive BOOLEAN` significaba «lo pausó el
-- archivado de su dueño», porque el archivado era la ÚNICA operación de cuenta que
-- pausaba anuncios. Al hacer que banear también los pause, ese booleano ya no
-- distingue quién los pausó — y desarchivar reactivaría lo que pausó el ban.
--
-- Se sustituye por un ENUM DE ORIGEN, que hace irrepresentable «pausado por dos
-- cosas a la vez»: un anuncio lo pausó UN gesto, el primero que lo encontró vivo.
--
-- MIGRACIÓN EN TRES PASOS Y SIN PÉRDIDA: se crea la columna nueva, se traduce lo
-- que había (`true` → `ARCHIVE`; `false` → `NULL`, «lo pausó su dueño») y sólo
-- entonces se retira la vieja. El backfill va ANTES del DROP a propósito: al revés
-- perdería las marcas de las cuentas archivadas que hoy esperan su desarchivado.

CREATE TYPE "ListingPauseOrigin" AS ENUM ('ARCHIVE', 'BAN');

ALTER TABLE "Listing" ADD COLUMN "pausedByAccountReason" "ListingPauseOrigin";

-- El único valor con significado que tenía el booleano. `false` es la ausencia de
-- marca, y la ausencia de marca es `NULL`: no hay nada que escribir para ésos.
UPDATE "Listing"
SET "pausedByAccountReason" = 'ARCHIVE'
WHERE "pausedByAccountArchive" = true;

ALTER TABLE "Listing" DROP COLUMN "pausedByAccountArchive";
