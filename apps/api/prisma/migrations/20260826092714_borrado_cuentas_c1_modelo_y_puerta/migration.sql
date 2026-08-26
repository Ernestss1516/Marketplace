-- BORRADO DE CUENTAS — C1: EL MODELO Y LA PUERTA
--
-- Hace REPRESENTABLES los estados nuevos de una cuenta y ARMA LAS SALVAGUARDAS.
-- NO archiva ni elimina nada: C1 no tiene ninguna operación. Quien usa esto es C2
-- (archivar/desarchivar), C4 (caducidad de la suspensión) y C5 (eliminar).
-- Ver docs/diseno-borrado-cuentas.md §8.
--
-- ESTA MIGRACIÓN NO BORRA NI UNA FILA. Añade dos valores de enum, un enum nuevo,
-- nueve columnas —todas nullable o con default, así que sin backfill salvo la de
-- snapshot—, y ENDURECE ocho claves ajenas. Ningún dato se pierde al aplicarla.
--
-- ── POR QUÉ LOS `RESTRICT` VAN AHORA, ANTES QUE CUALQUIER BORRADO ─────────────
--
-- Mismo orden y mismo motivo que B1 antes que B2 en el cuerpo de borrado de
-- anuncios: si la operación destructiva llegara primero, cada ejecución de las
-- primeras semanas destruiría evidencia en silencio. Aquí lo que se destruía era
-- peor que en B1 — la reputación de TERCEROS (ver el bloque de `Review`).
--
-- ── OJO: `DROP INDEX "User_lastLoginAt_desc_nulls_last_idx"` NO ESTÁ AQUÍ ──────
--
-- `prisma migrate dev --create-only` lo escribió, como escribe en CADA migración
-- nueva: es el índice raw de 5b (`20260822090000_indice_ultima_conexion`) y Prisma
-- no sabe expresar `NULLS LAST` en un `@@index`, así que lo lee como drift y propone
-- tirarlo. Se ha BORRADO del SQL generado, que es la regla que dejó escrita el
-- incidente de 7b (estado-tecnico.md: «al generar una migración, leer el SQL y
-- borrar ese DROP INDEX»). La barrera de origen que recorre las migraciones lo
-- habría cazado igualmente.

-- ── 1. Los enums ─────────────────────────────────────────────────────────────
-- ArchiveReason: por qué se archivó. Enum y no texto libre porque LA RAZÓN
-- DETERMINA LA SALIDA (el plazo antes de poder eliminar, y qué se hace con la IP).
CREATE TYPE "ArchiveReason" AS ENUM ('SELF_REQUEST', 'STAFF_ACTION');

-- UserStatus gana los dos estados de EXISTENCIA, junto a los tres de SANCIÓN.
-- ARCHIVED es reversible y no anonimiza; DELETED es terminal y es donde queda la
-- fila ya vaciada de persona. Un solo eje a propósito: ver el comentario del enum
-- en schema.prisma y el diseño §1.
--
-- Postgres 16 (postgis/postgis:16-3.5) admite ADD VALUE dentro de la transacción de
-- la migración; lo que no admite es USAR el valor nuevo en esa misma transacción, y
-- aquí no se usa ninguno: C1 no escribe ni un `status`.
ALTER TYPE "UserStatus" ADD VALUE 'ARCHIVED';
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

-- ── 2. Soltar las ocho FK viejas (CASCADE) ───────────────────────────────────
ALTER TABLE "Review" DROP CONSTRAINT "Review_authorId_fkey";
ALTER TABLE "Review" DROP CONSTRAINT "Review_targetId_fkey";
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_sellerId_fkey";
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_buyerId_fkey";
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_userId_fkey";
ALTER TABLE "Entitlement" DROP CONSTRAINT "Entitlement_userId_fkey";
ALTER TABLE "CouponRedemption" DROP CONSTRAINT "CouponRedemption_userId_fkey";
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_fkey";

-- ── 3. Las columnas ──────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN     "suspendedUntil" TIMESTAMP(3),
                   ADD COLUMN     "archivedAt" TIMESTAMP(3),
                   ADD COLUMN     "archiveReason" "ArchiveReason",
                   ADD COLUMN     "archiveNote" TEXT,
                   ADD COLUMN     "archivedById" TEXT,
                   ADD COLUMN     "statusBeforeArchive" "UserStatus",
                   ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- La marca que permite que desarchivar devuelva SÓLO los anuncios que pausó el
-- archivado, y no los que el vendedor había pausado por su cuenta.
ALTER TABLE "Listing" ADD COLUMN     "pausedByAccountArchive" BOOLEAN NOT NULL DEFAULT false;

-- El snapshot que falta para que la cola de moderación siga teniendo SUJETO cuando
-- una cuenta se vacíe (`User.name` pasa a «Usuario eliminado» y la cola lee el
-- nombre por la relación).
ALTER TABLE "Report" ADD COLUMN     "reportedUserName" TEXT;

-- ── 4. BACKFILL del snapshot ─────────────────────────────────────────────────
-- De aquí en adelante lo escribe quien CREA la denuncia (diseño §2.5, molde B1).
-- Las denuncias que ya existen no pasaron por ese camino, y sin esto se quedarían
-- para siempre sin sujeto legible en cuanto su denunciado se vaciara. Se rellenan
-- AHORA, que es el único momento en que los nombres todavía están ahí para
-- copiarlos: aplazarlo es perder el dato.
UPDATE "Report" r
   SET "reportedUserName" = u."name"
  FROM "User" u
 WHERE r."reportedUserId" = u."id"
   AND r."reportedUserName" IS NULL;

-- ── 5. Las FK nuevas ─────────────────────────────────────────────────────────
-- Quién archivó: SetNull, molde `Review.retiredById` / `Ticket.closedById` — que se
-- vacíe la cuenta de un moderador no puede desarchivar a nadie.
ALTER TABLE "User" ADD CONSTRAINT "User_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Las ocho, ahora RESTRICT. `Restrict` y no `SetNull` porque las ocho columnas son
-- NOT NULL: hacerlas nullables obligaría a todos sus lectores a tratar un `null`
-- para un caso que ya no puede ocurrir. Lo que declara `Restrict` es el invariante
-- correcto —estas filas no pueden quedarse huérfanas de persona— y hace que lo
-- garantice Postgres, no la disciplina de quien escriba el próximo servicio.
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
