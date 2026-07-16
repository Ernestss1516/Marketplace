-- Monetización ráfaga 4 — retirada del pack de bumps-vía-créditos. Paso 2 de 2
-- (schema): elimina la columna que ya no lee ningún código, ahora que el
-- pack que la usaba fue desactivado en la migración de datos anterior
-- (20260716090500_deactivate_highlightbumps_pack) y todas las referencias de
-- código (backend + frontend + tests) fueron retiradas. Mismo patrón de dos
-- pasos que drop_contact_motivo_enum / drop_post_footer_fields.

-- AlterTable
ALTER TABLE "CreditPack" DROP COLUMN "highlightBumps";
