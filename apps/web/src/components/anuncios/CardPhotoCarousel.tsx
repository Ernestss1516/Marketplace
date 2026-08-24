'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PhotoLightbox } from './PhotoLightbox';
import { VideoIndicator } from './VideoIndicator';

interface CardPhotoCarouselProps {
  images: string[];
  title: string;
  /** Aspect-ratio + sizing classes for the media container — square for ListingCard,
   * wider for ListingCardWide. Caller owns the shape; this component owns the navigation. */
  aspectClassName?: string;
  sizes: string;
  priority?: boolean;
  /**
   * Vídeo Pro — SOLO un booleano, nunca la URL.
   *
   * Es lo que permite pintar el indicador sin descargar un byte de vídeo: sin la dirección,
   * no hay nada que pedir. Que el contrato de este componente sea un booleano y no una URL
   * es la garantía estructural del cero-bytes-en-listas — la disciplina se olvida, un tipo
   * no.
   */
  hasVideo?: boolean;
  /** Overlay badges (Destacado, favorito) — rendered by the caller, absolutely
   * positioned inside this component's `relative` container. */
  children?: React.ReactNode;
}

/**
 * Carrusel de fotos dentro de la card (RÁFAGA 2): flechas/puntos para navegar sin
 * salir de la lista, clic para ampliar a pantalla completa (PhotoLightbox).
 *
 * RENDIMIENTO — el punto central de este componente: solo se monta un <Image> a
 * la vez, el de `index`. En el render inicial `index=0`, así que el navegador
 * SOLO pide la primera foto de cada anuncio. Las demás no se mencionan en el DOM
 * hasta que el usuario pulsa una flecha/punto (o abre el visor) y cambia `index`
 * — en ese momento, y solo en ese momento, React monta el <Image> de esa foto y
 * el navegador la pide. No hay ninguna bandera "hasInteracted" que gestionar: la
 * pereza sale gratis de renderizar por índice en vez de renderizar el array entero.
 */
export function CardPhotoCarousel({
  images,
  title,
  aspectClassName = 'aspect-square',
  sizes,
  priority = false,
  hasVideo = false,
  children,
}: CardPhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (images.length === 0) {
    return (
      <div className={`relative ${aspectClassName} overflow-hidden bg-muted`}>
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Sin foto
        </div>
        {children}
      </div>
    );
  }

  function go(delta: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  function openLightbox(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLightboxOpen(true);
  }

  return (
    <div className={`relative ${aspectClassName} overflow-hidden bg-muted`}>
      <button
        type="button"
        onClick={openLightbox}
        className="absolute inset-0 h-full w-full cursor-zoom-in"
        aria-label="Ampliar foto"
        data-testid="card-photo-open-lightbox"
      >
        <Image
          src={images[index]}
          alt={title}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          sizes={sizes}
          priority={priority && index === 0}
        />
      </button>

      {/*
        Vídeo Pro — EL INDICADOR, y NADA MÁS. El marcado vive en `VideoIndicator` desde que
        otras tres superficies (Mis anuncios y las dos del mapa) tuvieron que pintarlo
        también: no pasan por este carrusel, y copiar el `<span>` tres veces habría sido
        crear tres sitios donde el icono, el texto o el testid pueden separarse.

        Lo que NO cambia es la garantía: a este componente solo le llega un booleano, así
        que no hay `<video>` ni dirección que descargar. Ver VideoIndicator.tsx.
      */}
      {hasVideo && <VideoIndicator />}

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => go(-1, e)}
            aria-label="Foto anterior"
            className="absolute left-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            data-testid="card-photo-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => go(1, e)}
            aria-label="Foto siguiente"
            className="absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            data-testid="card-photo-next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-1">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIndex(i); }}
                aria-label={`Ver foto ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/50'}`}
                data-testid={`card-photo-dot-${i}`}
              />
            ))}
          </div>
        </>
      )}

      {children}

      {lightboxOpen && (
        <PhotoLightbox
          images={images}
          startIndex={index}
          title={title}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
