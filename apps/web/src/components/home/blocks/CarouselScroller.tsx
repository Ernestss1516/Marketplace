'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * ISLAND DE DESPLAZAMIENTO — y nada más.
 *
 * No genera contenido ni decide qué se ve: las categorías llegan como `children`
 * ya renderizados en el SERVIDOR y viajan enteras en el HTML. Esto solo añade
 * dos flechas que hacen `scrollBy` sobre el contenedor.
 *
 * Es el patrón "isla sobre contenido ya presente" que el proyecto ya usa
 * (FaqBlockRenderer, servidor, montando un Accordion cliente). La diferencia con
 * `CardPhotoCarousel` —el carrusel de fotos de las tarjetas— es deliberada y va
 * en sentido contrario: aquel monta UN solo `<Image>`, el del índice actual, por
 * rendimiento; aquí las N categorías tienen que estar TODAS en el HTML porque
 * son enlaces internos que un crawler debe ver.
 *
 * Si el JS no llega, no se pierde nada: el contenedor sigue teniendo
 * `overflow-x-auto` y se arrastra con el dedo o la rueda. Las flechas son una
 * comodidad, no el mecanismo.
 */
export function CarouselScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function desplazar(direccion: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    // Un 80 % del ancho visible: avanza casi una "pantalla" pero deja a la vista
    // el borde de la siguiente tarjeta, que es lo que indica que hay más.
    el.scrollBy({ left: direccion * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
        data-testid="carousel-scroller"
      >
        {children}
      </div>

      {/* `hidden sm:flex`: en táctil se arrastra, que es mejor que apuntar a una
          flecha pequeña. aria-hidden + tabindex -1 porque NO añaden nada que no
          se pueda hacer ya con el teclado sobre los propios enlaces: anunciarlas
          solo metería dos paradas de foco sin destino. */}
      <button
        type="button"
        onClick={() => desplazar(-1)}
        className="absolute -left-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background shadow-sm transition-colors hover:bg-muted sm:flex"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="carousel-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => desplazar(1)}
        className="absolute -right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background shadow-sm transition-colors hover:bg-muted sm:flex"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="carousel-next"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
