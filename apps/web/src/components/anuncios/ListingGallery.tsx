'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { isSafeSrc } from '@/lib/image-domains';
import { VideoPlayer } from './VideoPlayer';
import type { ListingImage } from '@/types';

interface Props {
  images: ListingImage[];
  title: string;
  /** Vídeo Pro — URL en nuestro propio almacenamiento. Ausente = el anuncio no tiene vídeo. */
  videoUrl?: string | null;
  /** Frame de portada. Sin él, el reproductor sería un rectángulo negro. */
  videoPosterUrl?: string | null;
}

export function ListingGallery({ images, title, videoUrl, videoPosterUrl }: Props) {
  /**
   * El vídeo es UNA MINIATURA MÁS de la galería, no una pieza aparte: la tira ya existía y
   * el visor principal ya era `aspect-video`, así que no hay nada que reestructurar.
   *
   * `selected = -1` es el vídeo; 0..n-1 son las fotos. Va DESPUÉS de la portada a propósito:
   * esa foto es la que el vendedor eligió como su mejor imagen y la que se ve en las listas,
   * y sustituirla rompería la continuidad entre lo que el usuario vio en la búsqueda y lo
   * que encuentra al entrar.
   */
  const [selected, setSelected] = useState(0);

  /**
   * VALIDACIÓN DE ORIGEN — esta es la única que tiene el vídeo.
   *
   * Un `<video src>` NO pasa por `remotePatterns` de next/image, a diferencia de un `<Image>`.
   * Sin esta comprobación el vídeo sería la única media del producto sin restricción de
   * dominio. El backend ya valida al guardar; esto es la segunda capa, y la que evita pintar
   * algo ajeno si un dato antiguo o manipulado llegara hasta aquí.
   */
  const video = videoUrl && isSafeSrc(videoUrl) ? videoUrl : null;
  const poster = videoPosterUrl && isSafeSrc(videoPosterUrl) ? videoPosterUrl : undefined;

  if (images.length === 0 && !video) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        Sin fotos
      </div>
    );
  }

  const mostrandoVideo = selected === -1 && video;

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {mostrandoVideo ? (
          /*
            El reproductor vive en `VideoPlayer`, compartido con el del backoffice. Con el
            `<video>` escrito a mano aquí y otro allí, los dos habían divergido en
            `preload` y en la validación de origen — ver la cabecera de ese fichero. Lo
            único propio de ESTA pantalla es el póster: si el vídeo no trae uno, sirve la
            primera foto del anuncio, que es lo que el usuario acaba de ver en la lista.
          */
          <VideoPlayer
            src={video}
            poster={poster ?? images[0]?.url}
            className="h-full w-full object-contain"
          />
        ) : (
          <Image
            src={images[selected]?.url ?? images[0].url}
            alt={images[selected]?.alt ?? title}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 60vw"
            priority
          />
        )}
      </div>

      {(images.length > 1 || video) && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              aria-label={`Ver foto ${i + 1}`}
              className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded border-2 transition-colors ${
                i === selected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt ?? `${title} — foto ${i + 1}`}
                fill
                className="object-cover"
                sizes="64px"
              />
            </button>
          ))}

          {video && (
            <button
              onClick={() => setSelected(-1)}
              aria-label="Ver el vídeo"
              className={`relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted transition-colors ${
                selected === -1 ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
              }`}
              data-testid="ficha-video-miniatura"
            >
              {/* La miniatura usa el PÓSTER, que es una imagen: elegirla no descarga vídeo.
                  El `<video>` solo se monta al seleccionarla, y aun entonces con
                  `preload="none"`. */}
              {poster && (
                <Image src={poster} alt="" fill className="object-cover" sizes="64px" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Play className="h-5 w-5 fill-white text-white" aria-hidden />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
