'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
 *
 * BUG encontrado y arreglado (post-RÁFAGA 2): ListingCard/ListingCardWide envuelven
 * TODA la card en un <Link> a la ficha del anuncio; este componente se montaba
 * como hijo normal de ese árbol. Aunque los botones ya llamaban a `stopPropagation()`,
 * eso no bastaba: la navegación de un <a> al hacer click es la acción POR DEFECTO
 * del navegador, gobernada por `preventDefault()` — y ninguno de los botones de
 * aquí lo llamaba. Confirmado en vivo con Playwright: click en "Cerrar" navegaba
 * igualmente a /anuncio/... pese al stopPropagation.
 *
 * LA CURA — `createPortal` monta este árbol en `document.body`, fuera del <a> a
 * efectos del DOM real: elimina la navegación NATIVA del navegador de raíz (el
 * navegador decide si sigue un enlace mirando el DOM real, y aquí ya no hay
 * relación de ancestro/descendiente). PERO — matiz importante encontrado
 * escribiendo el test — React vuelve a "reenganchar" un portal AL ÁRBOL DE REACT
 * (no al del DOM) para el burbujeo de sus eventos sintéticos: un click dentro de
 * este portal SIGUE alcanzando el onClick de React del <a> (que es lo que usa
 * Next.js `<Link>` para navegar) salvo que se corte con `stopPropagation()` en
 * el camino. El portal quita el riesgo del navegador; `stopPropagation()` en
 * CADA manejador de aquí (incluido el backdrop) quita el de React/Next — hacen
 * falta las dos cosas, no una sola.
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${title}`}
      // stopPropagation aquí también: React vuelve a "engancharse" al árbol de React (no
      // al del DOM) para el burbujeo de eventos de un portal — createPortal saca el
      // visor del <a> a efectos del DOM (por eso el navegador ya no navega solo), pero
      // un click aquí seguiría llegando al onClick del <a> vía React si no se corta aquí
      // (encontrado escribiendo el test: sin este stopPropagation, el backdrop SÍ disparaba
      // el <a> pese al portal — la cura estructural del portal no exime de cortar la
      // propagación en cada manejador, solo evita la navegación NATIVA del navegador).
      onClick={(e) => { e.stopPropagation(); onClose(); }}
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
    </div>,
    document.body,
  );
}
