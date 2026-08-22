-- A2 — LA LISTA DE TELÉFONOS MARCADOS: dos valores de enum, y nada más.
--
-- ESCRITA A MANO igual que la de A1, y por el mismo motivo práctico: desde que aquélla
-- recreó el tipo `DetectorId`, la base de sombra de `prisma migrate dev` no consigue
-- diferenciar y su única salida es proponer un `reset` de la base entera. Añadir un valor a
-- un enum es una línea; escribirla cuesta menos que pelearse con el diff.
--
-- AÑADIR es seguro y no toca ninguna fila: al revés que quitar (A1), que obligó a borrar las
-- filas y recrear el tipo. Aquí no hay orden que cuidar.
--
-- `IF NOT EXISTS` para que sea idempotente: si alguien la aplicó a mano en una base de
-- desarrollo, volver a pasarla no revienta.

-- El detector: «este número concreto está marcado». Convive con `PHONE`, que persigue otra
-- cosa (que el teléfono esté FUERA de su sitio).
ALTER TYPE "DetectorId" ADD VALUE IF NOT EXISTS 'PHONE_LIST';

-- El campo `Listing.phone`, el sitio LEGÍTIMO del teléfono. Sólo lo mira `PHONE_LIST`: un
-- número marcado lo está esté donde esté, mientras que un teléfono en su propio campo no
-- esquiva nada y por eso `PHONE` no lo mira.
ALTER TYPE "DetectionField" ADD VALUE IF NOT EXISTS 'PHONE';

-- NO SE CREA NINGÚN AJUSTE. `Setting['flaggedPhones']` nace sin fila, como `badWordList` y
-- `flaggedIps`: sin lista no se marca a nadie, que es el estado correcto de partida.
