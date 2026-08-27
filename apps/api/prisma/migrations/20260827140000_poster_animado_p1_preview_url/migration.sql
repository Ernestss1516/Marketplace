-- PÓSTER ANIMADO P1 — la columna del sprite.
--
-- Un sprite es cinco fotogramas del vídeo en una tira horizontal, dentro de UNA IMAGEN
-- FIJA. Se captura en el navegador al subir el vídeo (el único momento en que el fichero
-- está en memoria) y se guarda en `listing-previews/`, un prefijo propio: ni el del vídeo
-- —que es la cadena que el barrido e2e busca para dar por rota la garantía— ni el de las
-- imágenes de anuncio, que crea fila y pasa por sharp.
--
-- ADITIVA Y NULLABLE, sin backfill y sin `DEFAULT`: los vídeos ya subidos nacen con `null`,
-- que es exactamente lo que significa —«este vídeo no tiene previsualización»—. NO se pueden
-- regenerar en el servidor: para capturar un fotograma hay que decodificar el vídeo, y
-- decodificar es ffmpeg, la dependencia que este proyecto evita. Se irán poblando solos a
-- medida que la gente vuelva a subir.
--
-- Ver docs/diseno-poster-animado.md §3.1 y §3.4.

ALTER TABLE "Listing" ADD COLUMN "videoPreviewUrl" TEXT;
