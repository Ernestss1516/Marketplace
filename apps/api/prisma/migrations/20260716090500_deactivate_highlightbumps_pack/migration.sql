-- Monetización ráfaga 4 — retirada del pack de bumps-vía-créditos (Opción B,
-- ráfaga 2): sustituido por BumpPack (bumps directos). Paso 1 de 2 (dato):
-- desactivar el CreditPack marcado highlightBumps=true Y su Price asociado.
--
-- Desactivar SOLO CreditPack.active NO basta: BillingService.getCatalog()
-- filtra el catálogo público por Product.active/Price.active, nunca por
-- CreditPack.active — un pack con CreditPack.active=false pero Price
-- inalterado seguiría apareciendo y siendo comprable. Hallazgo de diseño,
-- cerrado aquí desactivando ambos.
--
-- Las Transaction históricas que referencian este Price/CreditPack NO se
-- tocan — siguen íntegras, igual que cualquier Price desactivado hoy no
-- afecta al histórico de compras ya hechas.
--
-- Paso 2 (schema: DROP COLUMN "highlightBumps") en una migración posterior,
-- una vez retirado todo el código que la referencia — mismo patrón de dos
-- pasos que drop_contact_motivo_enum / drop_post_footer_fields.

UPDATE "Price"
SET "active" = false
WHERE "creditPackId" IN (SELECT "id" FROM "CreditPack" WHERE "highlightBumps" = true);

UPDATE "CreditPack"
SET "active" = false
WHERE "highlightBumps" = true;
