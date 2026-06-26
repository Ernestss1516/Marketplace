-- Migration: add_entitlement_revoked_at
-- Adds revokedAt to Entitlement to track explicit revocations (expiration cron,
-- admin manual revoke). An entitlement is VALID only when revokedAt IS NULL.
-- NULL default ensures all existing rows remain valid after the migration.

ALTER TABLE "Entitlement" ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "Entitlement_revokedAt_idx" ON "Entitlement"("revokedAt");
