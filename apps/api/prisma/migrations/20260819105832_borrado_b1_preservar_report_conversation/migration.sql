-- BORRADO — RÁFAGA B1: «los registros dejan de morir».
--
-- QUÉ CAMBIA Y POR QUÉ. `Report.listingId` y `Conversation.listingId` eran
-- `ON DELETE CASCADE`: borrar un anuncio DESTRUÍA sus denuncias y sus
-- conversaciones enteras (con todos los mensajes). Y borrar, hoy, es del DUEÑO
-- del anuncio — así que el denunciado podía destruir la denuncia, y el vendedor
-- el hilo que probaba lo que dijo, por la vía más fácil que existe.
--
-- Pasan a `ON DELETE SET NULL` + una columna de contexto, que es el patrón que
-- este repo ya había elegido TRES veces para lo mismo: `Review.listingTitle`,
-- `Deal.listingTitle` y `Ticket.linkedLabel`. Ver docs/diseno-borrado.md §2.4-2.5.
--
-- ESTA MIGRACIÓN NO BORRA NADA y no cambia ninguna fila existente de sitio: sólo
-- afloja una restricción, añade dos columnas y las rellena. Es reversible en el
-- sentido que importa — ningún dato se pierde al aplicarla.

-- ── 1. Soltar las FK viejas (CASCADE) ───────────────────────────────────────
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_listingId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_listingId_fkey";

-- ── 2. Las columnas de contexto, y el anuncio deja de ser obligatorio ────────
-- `Conversation.listingId` pasa a nullable: es la condición para que un SET NULL
-- sea posible. `Report.listingId` ya era nullable (una denuncia puede apuntar a
-- un usuario o a una valoración en vez de a un anuncio).
ALTER TABLE "Conversation" ADD COLUMN "listingTitle" TEXT,
                           ALTER COLUMN "listingId" DROP NOT NULL;
ALTER TABLE "Report" ADD COLUMN "listingTitle" TEXT;

-- ── 3. BACKFILL ─────────────────────────────────────────────────────────────
-- De aquí en adelante el título lo escribe quien CREA la denuncia o la
-- conversación (diseño §3.3). Pero las filas que ya existen no pasaron por ese
-- camino, y sin esto se quedarían para siempre sin contexto en cuanto su anuncio
-- se borrara. Se rellenan AHORA, que es el único momento en que los anuncios
-- todavía están ahí para copiarlos: aplazarlo es perder el dato.
UPDATE "Conversation" c
   SET "listingTitle" = l."title"
  FROM "Listing" l
 WHERE c."listingId" = l."id"
   AND c."listingTitle" IS NULL;

UPDATE "Report" r
   SET "listingTitle" = l."title"
  FROM "Listing" l
 WHERE r."listingId" = l."id"
   AND r."listingTitle" IS NULL;

-- ── 4. Las FK nuevas (SET NULL) ─────────────────────────────────────────────
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
