-- Backfill expiresAt for listings published before auto-expiry was introduced.
-- expiresAt was already in the schema but publish() never set it.
-- Sets expiresAt = publishedAt + 60 days for every listing where publishedAt is
-- known but expiresAt is still null. Safe to re-run (WHERE clause is idempotent).
UPDATE "Listing"
SET "expiresAt" = "publishedAt" + INTERVAL '60 days'
WHERE "publishedAt" IS NOT NULL AND "expiresAt" IS NULL;
