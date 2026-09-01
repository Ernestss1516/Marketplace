import type { HomeVideoUploadBlock } from '@/types/home-blocks';
import { VideoPlayer } from '@/components/media/VideoPlayer';

/**
 * El bloque de VÍDEO SUBIDO en la portada. Hermano del del blog, y **los dos montan el mismo
 * `VideoPlayer`**: es la regla de reuso entre los dos motores (ver la cabecera de
 * `types/home-blocks.ts`) — se comparte todo componente cuya firma no mencione un tipo de
 * bloque, y la de `VideoPlayer` sólo habla de una dirección y un póster.
 *
 * Lo único propio de la portada es el ancho: los bloques de aquí ocupan la franja completa,
 * así que el vídeo se centra con un tope para que no se vea gigante en un monitor ancho.
 */
export function VideoUploadHomeBlockRenderer({ block }: { block: HomeVideoUploadBlock }) {
  return (
    <figure className="mx-auto w-full max-w-4xl px-4">
      <VideoPlayer
        src={block.url}
        poster={block.poster}
        className="w-full rounded-lg"
        testId="home-bloque-video-subido"
      />
      {block.caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
