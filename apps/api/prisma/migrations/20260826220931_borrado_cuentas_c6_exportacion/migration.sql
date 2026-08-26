-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- NOTA (7b · ÚLTIMA IP): aquí Prisma vuelve a generar un DROP del índice
-- "User_lastLoginAt_desc_nulls_last_idx", y se ha BORRADO A MANO, igual que en
-- C1 y en C5. Ese índice está escrito a mano (NULLS LAST) porque Prisma no sabe
-- expresarlo, así que su introspección no lo reconoce y propone eliminarlo en
-- CADA migración posterior. Dejarlo pasar tumbaría el orden de /admin/usuarios.
-- Hay una barrera que vigila esto: `ultima-ip-orden.e2e-spec.ts`.

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "key" TEXT,
    "sizeBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExport_subjectUserId_status_idx" ON "DataExport"("subjectUserId", "status");

-- CreateIndex
CREATE INDEX "DataExport_status_expiresAt_idx" ON "DataExport"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
