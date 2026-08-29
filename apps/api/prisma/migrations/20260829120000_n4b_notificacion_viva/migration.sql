-- ESCRITA A MANO Y APLICADA CON `migrate deploy`, no con `migrate dev`. La razón está en la
-- migración de N3 y en las cuatro anteriores: `migrate dev` vuelve a proponer el DROP del
-- índice crudo `User_lastLoginAt_desc_nulls_last_idx` (Prisma no sabe expresar `NULLS LAST`)
-- y lo APLICA antes de que nadie lea el SQL, así que el índice se pierde en la base de
-- desarrollo; y editar el fichero después rompe su checksum. Las dos cosas ya pasaron.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- NOTIFICACIONES N4b — LA NOTIFICACIÓN VIVA.
--
-- El buzón nació append-only: cada evento, una fila inmutable. La mensajería necesita lo
-- contrario —UNA notificación por hilo cuyo contador sube—, porque una por mensaje
-- convertiría la campana en un chat roto.
--
-- EL `NULL` HACE EL REPARTO SOLO. En PostgreSQL los NULL no colisionan entre sí en un índice
-- único, así que este `UNIQUE`:
--   · NO restringe a las notificaciones de evento (nacen con groupKey NULL): siguen
--     append-only, tantas filas como eventos, SIN backfill y SIN cambio de conducta;
--   · SÍ hace únicas las de mensajería, habilitando el upsert atómico.
--
-- ADITIVA: la columna nace NULL para las 11 clases de aviso que ya existen. Ninguna conducta
-- cambia el día que esto se despliega.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "groupKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_type_groupKey_key" ON "Notification"("userId", "type", "groupKey");
