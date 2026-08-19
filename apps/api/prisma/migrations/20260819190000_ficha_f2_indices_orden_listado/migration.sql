-- FICHA F2 (P6) — LOS ÍNDICES DEL ORDEN POR DEFECTO DEL BACKOFFICE.
--
-- ESTRICTAMENTE ADITIVA: dos índices, ninguna columna, ningún dato tocado. No hay
-- backfill y ninguna fila cambia de comportamiento al aplicarla.
--
-- QUÉ ARREGLA. La lista de `/admin/anuncios` ordena por `updatedAt` —lo ha hecho
-- siempre, y la cola de revisión de M3 depende de ese orden invertido— y **no
-- había ningún índice sobre esa columna**. `Listing_status_publishedAt_idx` sirve
-- para filtrar por estado, pero no para ORDENAR por `updatedAt`, así que Postgres
-- recuperaba las filas y las ordenaba a mano. Con el volumen actual no se nota;
-- al crecer, la primera pantalla en degradarse es la principal del backoffice.
--
-- POR QUÉ DOS Y NO UNO. Son dos consultas distintas y ninguna cubre a la otra:
--   · con filtro de estado (la cola, y los filtros de F2) → el compuesto;
--   · sin filtro de estado (la vista «Todos», la de entrada) → el simple.

-- CreateIndex
CREATE INDEX "Listing_status_updatedAt_idx" ON "Listing"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Listing_updatedAt_idx" ON "Listing"("updatedAt");
