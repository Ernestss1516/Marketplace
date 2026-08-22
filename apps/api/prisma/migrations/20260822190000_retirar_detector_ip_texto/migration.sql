-- A1 — RETIRAR EL DETECTOR DE IP SOBRE TEXTO.
--
-- ESCRITA A MANO, y no por gusto: `prisma migrate dev` no sabe quitar un valor de un enum de
-- Postgres —no existe `ALTER TYPE ... DROP VALUE`— y su única salida es proponer un RESET de
-- la base entera. A mano se hace en el orden correcto y sin perder nada más.
--
-- EL ORDEN ES LA MITAD DEL TRABAJO: primero se borran las filas que usan el valor, y sólo
-- después se recrea el tipo. Al revés, el `ALTER TABLE` fallaría por filas que aún lo
-- referencian — y en una base con datos eso es un despliegue a medias.

-- 1. Las detecciones que dejó el detector retirado.
--
-- Se borran EN LA MIGRACIÓN y no se dejan morir solas. El reemplazo entero las quitaría al
-- editar cada anuncio, pero **los que nadie toque las conservarían para siempre**: una fila
-- de un detector que ya no existe es basura que le hace perder el tiempo al moderador y le
-- enseña a desconfiar del aviso.
DELETE FROM "ListingDetection" WHERE "detector" = 'IP';

-- 2. El tipo, sin `IP`. El baile de tres pasos es el único que Postgres admite.
ALTER TYPE "DetectorId" RENAME TO "DetectorId_old";
CREATE TYPE "DetectorId" AS ENUM ('WORD', 'PHONE');
ALTER TABLE "ListingDetection"
  ALTER COLUMN "detector" TYPE "DetectorId" USING ("detector"::text::"DetectorId");
DROP TYPE "DetectorId_old";

-- NO SE TOCA `Setting['detectionModes']`, que puede tener una clave `IP` de antes.
-- `parseDetectionModes` recorre los detectores QUE EXISTEN y descarta lo demás, así que una
-- clave sobrante es inerte. Reescribir un ajuste que un admin puso a mano para quitarle una
-- línea que ya no hace nada sería tocar su configuración sin motivo.
