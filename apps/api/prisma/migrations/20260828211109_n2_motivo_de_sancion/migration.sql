-- AQUÍ `prisma migrate dev` VOLVIÓ A ESCRIBIR ESTO, Y SE HA BORRADO A MANO:
--
--   DROP INDEX "User_lastLoginAt_desc_nulls_last_idx";
--
-- Es el índice de 5b, SQL crudo porque Prisma no sabe expresar `NULLS LAST` en un `@@index`.
-- Al no estar en `schema.prisma` lo lee como drift y lo propone en CADA migración nueva. Ya
-- se coló una vez y puso el CI en rojo con un P3018.
--
-- «LA BARRERA DE ORIGEN» (`ultima-ip-orden.e2e-spec.ts`) recorre las migraciones y falla si
-- alguna línea NO COMENTADA borra ese índice. Por eso el `DROP` puede quedarse citado aquí
-- dentro de un comentario: es la explicación, no el comando.
--
-- REGLA: al generar una migración, LEER el SQL y borrar ese `DROP INDEX`.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- NOTIFICACIONES N2 — EL MOTIVO DE UNA SANCIÓN DE CUENTA.
--
-- Hasta aquí, el motivo de una suspensión o un baneo no se perdía al mostrarlo: NUNCA LLEGABA
-- A CAPTURARSE. `SuspendUserDto` tenía un solo campo (`days`) y `banUser` no recibía cuerpo.
--
-- DOS COLUMNAS Y NO UNA, y la frontera entre ellas es el diseño:
--
--   · `sanctionReason` — VISIBLE. Se le muestra al usuario: viaja al snapshot de la
--     notificación, al correo y al mensaje del login (que es donde va a chocar, porque un
--     sancionado NO puede entrar a leer su campana).
--   · `sanctionNote`   — INTERNA. Sólo staff. Nunca sale hacia el usuario.
--
-- ADITIVA Y SIN BACKFILL: nacen `NULL` para todas las filas. Una sanción anterior a N2
-- simplemente no tiene motivo, y se degrada como un `ListingModerated.reason` nulo. Ninguna
-- conducta cambia el día que esto se despliega.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sanctionNote" TEXT,
ADD COLUMN     "sanctionReason" TEXT;
