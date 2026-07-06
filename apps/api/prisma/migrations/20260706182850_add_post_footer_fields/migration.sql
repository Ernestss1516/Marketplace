-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "footerOrder" INTEGER,
ADD COLUMN     "showInFooter" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Post_type_status_showInFooter_idx" ON "Post"("type", "status", "showInFooter");
