-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN     "motivoId" TEXT,
ALTER COLUMN "motivo" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ContactReason" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactReason_activo_orden_idx" ON "ContactReason"("activo", "orden");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "ContactReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
