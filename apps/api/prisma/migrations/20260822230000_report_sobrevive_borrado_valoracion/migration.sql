-- BORRADO — `Report.reviewId`: de CASCADE a SET NULL + snapshot.
--
-- QUÉ CAMBIA Y POR QUÉ. Es la SEGUNDA arista del mismo defecto que arregló B1
-- (`20260819105832_borrado_b1_preservar_report_conversation`): allí una denuncia
-- moría con el ANUNCIO que señalaba; aquí moría con la VALORACIÓN. B1 lo dejó
-- anotado como «riesgo 5, fuera de alcance porque va de reseñas»
-- (docs/diseno-borrado.md §2.4 «ojo con el segundo salto», §6.2), y 7b lo
-- NEUTRALIZÓ sin resolverlo: retiró el único camino que borraba valoraciones en
-- vivo, así que hoy la regla no llega a dispararse — pero sigue armada para el
-- siguiente (purga RGPD, `deleteMany` de mantenimiento, cascada de usuario).
--
-- Se aplica el patrón que este repo ya eligió CUATRO veces para lo mismo:
-- `Report.listingTitle`, `Review.listingTitle`, `Deal.listingTitle` y
-- `Ticket.linkedLabel`. La denuncia sobrevive, y sobrevive CON SENTIDO: el
-- comentario denunciado y el nombre de quien lo escribió.
--
-- ESTA MIGRACIÓN NO BORRA NADA: afloja una restricción, añade dos columnas y las
-- rellena. Ningún dato se pierde al aplicarla.

-- ── 1. Soltar la FK vieja (CASCADE) ─────────────────────────────────────────
ALTER TABLE "Report" DROP CONSTRAINT "Report_reviewId_fkey";

-- ── 2. Las columnas de snapshot ─────────────────────────────────────────────
-- `Report.reviewId` ya era nullable (una denuncia puede apuntar a un anuncio o a
-- un usuario en vez de a una valoración), así que no hay que tocarlo.
ALTER TABLE "Report" ADD COLUMN "reviewComment" TEXT,
                     ADD COLUMN "reviewAuthorName" TEXT;

-- ── 3. BACKFILL ─────────────────────────────────────────────────────────────
-- De aquí en adelante el snapshot lo escribe quien CREA la denuncia (diseño
-- §3.3). Las denuncias de valoración que ya existen no pasaron por ese camino, y
-- sin esto se quedarían para siempre sin contexto en cuanto su valoración
-- desapareciera. Se rellenan AHORA, que es el único momento en que las
-- valoraciones todavía están ahí para copiarlas: aplazarlo es perder el dato.
UPDATE "Report" r
   SET "reviewComment"    = v."comment",
       "reviewAuthorName" = a."name"
  FROM "Review" v
  JOIN "User" a ON a."id" = v."authorId"
 WHERE r."reviewId" = v."id"
   AND r."reviewAuthorName" IS NULL;

-- ── 4. La FK nueva (SET NULL) ───────────────────────────────────────────────
ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;
