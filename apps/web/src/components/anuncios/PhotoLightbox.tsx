'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface PhotoLightboxProps {
  images: string[];
  startIndex: number;
  title: string;
  onClose: () => void;
}

/**
 * Visor a pantalla completa (RÁFAGA 2). Solo monta el <Image> del índice
 * actual — igual que CardPhotoCarousel, nunca hay más de una foto cargándose
 * a la vez, ni aquí ni en la card.
 */
export function PhotoLightbox({ images, startIndex, title, onClose }: PhotoLightboxProps) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % images.length);
    }
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [images.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${title}`}
      onClick={onClose}
      data-testid="photo-lightbox"
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Cerrar"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + images.length) % images.length); }}
            aria-label="Foto anterior"
            className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % images.length); }}
            aria-label="Foto siguiente"
            className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div className="relative h-[80vh] w-[90vw] max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <Image
          src={images[index]}
          alt={`${title} — foto ${index + 1} de ${images.length}`}
          fill
          className="object-contain"
          sizes="90vw"
          priority
        />
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
