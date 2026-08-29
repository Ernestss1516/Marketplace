-- ESCRITA A MANO Y APLICADA CON `migrate deploy` (ver la migración de N3 y N4b): `migrate dev`
-- vuelve a proponer el DROP del índice crudo `User_lastLoginAt_desc_nulls_last_idx` y lo
-- APLICA antes de que nadie lea el SQL.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- NOTIFICACIONES N5 — LA VÁLVULA DEL CORREO.
--
-- El sistema pasó de 8 tipos de correo a bastantes más, y N4b añadió el más frecuente de
-- todos (mensajería). Sin una forma de darse de baja, ese volumen es un problema de
-- entregabilidad antes que de gusto.
--
-- CUATRO COLUMNAS, NO UN jsonb: el valor por defecto lo pone la BASE (`true`), que es
-- exactamente el opt-out que se quiere. Con un jsonb, «la clave no está» tendría que
-- significar «sí» por convenio en código — y ese convenio se olvida.
--
-- SOLO CUBREN LAS INFORMATIVAS. No hay bandera para las sanciones, el borrado de cuenta, el
-- cambio de rol, lo que el staff hace con tus anuncios ni el dinero: esas no se pueden
-- silenciar, y su camino de envío ni siquiera mira estas columnas. Que no exista el
-- interruptor es parte de la garantía.
--
-- ADITIVA Y SIN BACKFILL: nacen TRUE, así que nadie deja de recibir nada al desplegar.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailListings" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailReviews" BOOLEAN NOT NULL DEFAULT true;
