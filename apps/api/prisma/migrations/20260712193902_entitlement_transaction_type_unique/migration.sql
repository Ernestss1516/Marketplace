-- Red de seguridad en BD contra doble concesión de FEATURED_LISTING: una
-- misma Transaction no puede generar dos entitlements del mismo tipo (ver
-- deuda "concesión de destacado" / retry de QUEUE_BILLING). NULLs no
-- colisionan entre sí (semántica estándar de UNIQUE en Postgres), así que
-- esto no afecta a los caminos que no llevan transactionId (cuota Pro,
-- créditos, cupón).
CREATE UNIQUE INDEX "Entitlement_transactionId_type_key" ON "Entitlement"("transactionId", "type");
