-- CreateEnum
CREATE TYPE "ContactMotivo" AS ENUM ('CONSULTA_GENERAL', 'PROBLEMA_TECNICO', 'DENUNCIA_CONTENIDO', 'FACTURACION', 'PRENSA', 'OTRO');

-- CreateEnum
CREATE TYPE "ContactEstado" AS ENUM ('NUEVO', 'LEIDO', 'RESPONDIDO', 'CERRADO');

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "motivo" "ContactMotivo" NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "mensaje" TEXT NOT NULL,
    "estado" "ContactEstado" NOT NULL DEFAULT 'NUEVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactReply" (
    "id" TEXT NOT NULL,
    "contactMessageId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_estado_createdAt_idx" ON "ContactMessage"("estado", "createdAt");

-- CreateIndex
CREATE INDEX "ContactReply_contactMessageId_idx" ON "ContactReply"("contactMessageId");

-- AddForeignKey
ALTER TABLE "ContactReply" ADD CONSTRAINT "ContactReply_contactMessageId_fkey" FOREIGN KEY ("contactMessageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactReply" ADD CONSTRAINT "ContactReply_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
