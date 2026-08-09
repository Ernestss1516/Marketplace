-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "videoDurationSeconds" INTEGER,
ADD COLUMN     "videoPosterUrl" TEXT,
ADD COLUMN     "videoUploadedAt" TIMESTAMP(3),
ADD COLUMN     "videoUrl" TEXT;
