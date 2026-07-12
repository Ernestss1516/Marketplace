-- Second step of the ContactMotivo enum → ContactReason (data) migration (RC.2).
-- MUST run after "add_contact_reason" and after `pnpm contact-reason-backfill`
-- has populated ContactMessage.motivoId for every existing row — same
-- two-step pattern as drop_post_footer_fields.

-- AlterTable
ALTER TABLE "ContactMessage" DROP COLUMN "motivo",
ALTER COLUMN "motivoId" SET NOT NULL;

-- DropEnum
DROP TYPE "ContactMotivo";
