-- OJO — AQUÍ `prisma migrate dev` HABÍA ESCRITO ESTO, Y SE HA BORRADO A MANO:
--
--   DROP INDEX "User_lastLoginAt_desc_nulls_last_idx";
--
-- Es el índice de 5b (`20260822090000_indice_ultima_conexion`), SQL crudo porque Prisma no
-- sabe expresar `NULLS LAST` en un `@@index`. Al no estar en `schema.prisma`, Prisma lo lee
-- como drift y propone tirarlo en CADA migración nueva que se genere. La propia migración de
-- 5b lo dejó avisado.
--
-- Localmente el `DROP` colaba (el índice ya existía) y sólo se notaba porque desaparecía en
-- silencio. En una base limpia reventaba: `20260822090000...` ordena DESPUÉS que esta, así
-- que esto tiraba un índice **que todavía no se había creado** → P3018, 42704.
--
-- REGLA: al generar una migración, LEER el SQL y borrar ese `DROP INDEX`. No hay forma de
-- que Prisma deje de proponerlo mientras el índice no quepa en el schema.

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredById" TEXT,
ADD COLUMN     "retiredReason" TEXT;

-- CreateIndex
CREATE INDEX "Review_retiredAt_idx" ON "Review"("retiredAt");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
