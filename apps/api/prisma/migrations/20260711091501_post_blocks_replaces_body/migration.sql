-- AlterTable
ALTER TABLE "Post" DROP COLUMN "body",
ADD COLUMN     "blocks" JSONB NOT NULL DEFAULT '[]';
