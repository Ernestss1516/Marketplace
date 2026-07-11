-- DropIndex
DROP INDEX "Post_type_status_showInFooter_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "footerGroup",
DROP COLUMN "footerOrder",
DROP COLUMN "showInFooter";
