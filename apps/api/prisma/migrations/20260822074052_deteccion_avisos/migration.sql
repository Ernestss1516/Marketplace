-- CreateEnum
CREATE TYPE "DetectorId" AS ENUM ('WORD', 'IP', 'PHONE');

-- CreateEnum
CREATE TYPE "DetectionField" AS ENUM ('TITLE', 'DESCRIPTION');

-- AQUÍ `prisma migrate dev` VOLVIÓ A ESCRIBIR ESTO, Y SE HA BORRADO A MANO:
--
--   DROP INDEX "User_lastLoginAt_desc_nulls_last_idx";
--
-- Es el índice de 5b, SQL crudo porque Prisma no sabe expresar `NULLS LAST` en un `@@index`.
-- Al no estar en `schema.prisma` lo lee como drift y lo propone en CADA migración nueva.
-- Ya se coló una vez (en la de 7b) y puso el CI en rojo con un P3018: `migrate deploy` ordena
-- por nombre, y aquella migración iba ANTES que la que crea el índice, así que tiraba algo
-- que todavía no existía. En local había colado en silencio, perdiendo el índice.
--
-- Hay una barrera que lo caza: «LA BARRERA DE ORIGEN» en `ultima-ip-orden.e2e-spec.ts`
-- recorre las migraciones y falla si alguna línea NO COMENTADA borra ese índice. Por eso el
-- `DROP` puede quedarse citado aquí dentro de un comentario: es la explicación, no el comando.
--
-- REGLA: al generar una migración, LEER el SQL y borrar ese `DROP INDEX`.

-- CreateTable
CREATE TABLE "ListingDetection" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "detector" "DetectorId" NOT NULL,
    "field" "DetectionField" NOT NULL,
    "match" TEXT NOT NULL,
    "rule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingDetection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingDetection_listingId_idx" ON "ListingDetection"("listingId");

-- CreateIndex
CREATE INDEX "ListingDetection_detector_idx" ON "ListingDetection"("detector");

-- AddForeignKey
ALTER TABLE "ListingDetection" ADD CONSTRAINT "ListingDetection_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
