-- ─────────────────────────────────────────────────────────────────────────────────────────
-- COOKIES RÁFAGA 1 — LA PRUEBA DEL CONSENTIMIENTO (RGPD art. 7.1).
--
-- Ver docs/diseno-consentimiento-cookies.md §2.3.
--
-- UNA FILA POR DECISIÓN, y nunca se actualiza: el historial ES la prueba. La cookie del
-- navegador DECIDE qué se carga; esta tabla DEMUESTRA que hubo consentimiento. Son dos
-- mitades con funciones distintas — una cookie no demuestra nada, la escribe el propio
-- sitio y el usuario puede borrarla.
--
-- `userId` ES NULLABLE Y VA CON `ON DELETE SET NULL`, Y ESA LÍNEA ES LA QUE IMPLEMENTA D7:
-- al borrar la cuenta el vínculo se anula solo y la fila sobrevive anonimizada, sin que
-- ningún código futuro tenga que acordarse de esta tabla. Hoy no existe ninguna vía que
-- borre un `User` (docs/auditoria-borrado-cuentas.md §0.1), así que hacerlo de otra forma
-- sería dejar una nota que alguien tendría que recordar dentro de meses. Mismo molde que
-- `ListingImage.uploadedById`, que «ya anonimiza por construcción» (ídem §3.2, fila 2).
--
-- NULLABLE TAMBIÉN PORQUE LA MAYORÍA DE LAS FILAS NACEN SIN USUARIO: el consentimiento se
-- da casi siempre antes de iniciar sesión, y ése es el caso normal, no la excepción.
--
-- NO HAY COLUMNA `userAgent` (decisión D-nueva-5): aporta poco a la prueba y es material
-- de huella. `ipHash` guarda `sha256(ip)`, nunca la IP en claro — el molde del proyecto
-- para esto (`visitor.ts:53`, `listings.controller.ts:314`).
--
-- ADITIVA Y SIN BACKFILL: tabla nueva, ninguna fila existente se toca, nada depende de
-- ella todavía. Desplegarla no cambia el comportamiento de nada.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'REJECTED', 'UPDATED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "categories" TEXT[],
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El consentimiento vigente de un usuario es su fila más reciente.
CREATE INDEX "ConsentRecord_userId_createdAt_idx" ON "ConsentRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_createdAt_idx" ON "ConsentRecord"("createdAt");

-- AddForeignKey
-- D7: SET NULL, no CASCADE. Borrar la cuenta anonimiza la prueba; no la destruye.
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
