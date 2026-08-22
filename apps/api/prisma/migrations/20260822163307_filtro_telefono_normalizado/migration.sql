-- AQUÍ `prisma migrate dev` VOLVIÓ A ESCRIBIR ESTO, Y SE HA BORRADO A MANO:
--
--   DROP INDEX "User_lastLoginAt_desc_nulls_last_idx";
--
-- Es el índice de 5b, SQL crudo porque Prisma no sabe expresar `NULLS LAST` en un `@@index`.
-- Al no estar en `schema.prisma` lo lee como drift y lo propone en CADA migración nueva. Ya
-- se coló una vez y puso el CI en rojo con un P3018.
--
-- «LA BARRERA DE ORIGEN» (`ultima-ip-orden.e2e-spec.ts`) recorre las migraciones y falla si
-- alguna línea NO COMENTADA borra ese índice. Por eso el `DROP` puede quedarse citado aquí
-- dentro de un comentario: es la explicación, no el comando.
--
-- REGLA: al generar una migración, LEER el SQL y borrar ese `DROP INDEX`.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "phoneNormalized" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BACKFILL — los anuncios que YA existen.
--
-- Sin esto la columna nace vacía y el filtro por teléfono sólo encontraría los anuncios
-- creados o editados DESPUÉS del despliegue: el moderador buscaría un número, no saldría
-- nada, y concluiría que ese teléfono no está en la plataforma. Un filtro que devuelve vacío
-- por estar a medio poblar miente peor que uno que no existe.
--
-- ESTA ES LA ÚNICA VEZ QUE LA REGLA SE ESCRIBE EN SQL. La de verdad vive en
-- `detection/phone-format.ts` y es la que se aplica en cada escritura; esto es un arranque
-- de una sola ejecución, no una regla viva que pueda divergir. Aun así se escribe para
-- coincidir con ella EXACTAMENTE:
--
--   · quitar todo lo que no sea dígito;
--   · si quedan 9, ésos;
--   · si son `34…` o `0034…` seguidos de 9, los nueve últimos;
--   · y sólo vale si empiezan por 6-9. Cualquier otra cosa → NULL, que es «no es un
--     teléfono español», no «no lo sé».
-- ─────────────────────────────────────────────────────────────────────────────────────────
UPDATE "Listing" l
SET "phoneNormalized" = (
  SELECT CASE
    WHEN t.dig ~ '^[6-9][0-9]{8}$' THEN t.dig
    WHEN t.dig ~ '^(00)?34[6-9][0-9]{8}$' THEN right(t.dig, 9)
    ELSE NULL
  END
  FROM (SELECT regexp_replace(l."phone", '[^0-9]', '', 'g') AS dig) t
)
WHERE l."phone" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- SIN ÍNDICE, Y ESTÁ MEDIDO — no es un olvido.
--
-- Con 80.000 anuncios sintéticos (26.666 con teléfono), el plan real de la consulta que
-- ejecuta el filtro —igualdad sobre esta columna, con el `ORDER BY updatedAt DESC LIMIT 24`
-- del listado— es:
--
--     Seq Scan on "Listing"  (rows removed by filter: 80006)
--     Execution Time: 8,1 ms
--
-- Ocho milisegundos, contra el umbral de ~300 ms que este mismo backoffice tiene escrito
-- para su consulta más caliente (ver `listListings`). Es 37 veces menos, así que **hoy no lo
-- justifica**: es el mismo criterio con el que F2 SÍ añadió un índice tras medir y E2
-- decidió NO añadirlo tras medir. Añadirlo antes es inventarse un problema.
--
-- CRECE LINEAL: a un millón de anuncios serían ~100 ms. Cuando la tabla se acerque, un
-- B-tree sobre esta columna es la salida y **no obliga a cambiar la consulta**.
-- ─────────────────────────────────────────────────────────────────────────────────────────
