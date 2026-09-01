import type { VideoUploadBlock } from '@/types/blocks';
import { VideoPlayer } from '@/components/media/VideoPlayer';

/**
 * El bloque de VÍDEO SUBIDO. Envoltura fina: todo lo que importa —`preload="none"`, la
 * validación de origen, `controls` sin `autoPlay`— vive en `VideoPlayer`, que se reutiliza
 * **literal** y no se copia.
 *
 * POR QUÉ NO SE ESCRIBE UN `<video>` AQUÍ, aunque serían cuatro líneas: eso es exactamente lo
 * que había antes de que `VideoPlayer` existiera —dos `<video>` a mano, uno en la ficha
 * pública y otro en el backoffice— y **habían divergido en las dos cosas que importan**, el
 * `preload` y la comprobación de dominio. Un tercero volvería a abrir esa puerta.
 *
 * `VideoPlayer` devuelve `null` si la dirección no es de nuestro almacenamiento, así que un
 * bloque con una URL antigua o manipulada no pinta un reproductor roto: no pinta nada, y la
 * página sigue en pie.
 */
export function VideoUploadBlockRenderer({ block }: { block: VideoUploadBlock }) {
  return (
    <figure>
      <VideoPlayer
        src={block.url}
        poster={block.poster}
        className="w-full rounded-lg"
        testId="bloque-video-subido"
      />
      {block.caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
