-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('POST', 'PAGE');

-- DropIndex
DROP INDEX "Post_status_publishedAt_idx";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "type" "PostType" NOT NULL DEFAULT 'POST';

-- CreateIndex
CREATE INDEX "Post_type_status_publishedAt_idx" ON "Post"("type", "status", "publishedAt");
