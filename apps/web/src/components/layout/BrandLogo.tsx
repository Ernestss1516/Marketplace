import type { BrandMark } from '@/lib/brand';

/**
 * TRES LOGOS L2 — la marca, pintada. Imagen si la hay; el nombre si no.
 *
 * NI FETCH NI ESTADO: recibe la marca ya resuelta (`resolveBrand`). Eso es lo que le
 * permite servir a las tres zonas —una cabecera de servidor, un layout de servidor y
 * un componente de cliente— sin `'use client'` propio y sin que ninguna tenga que
 * saber cómo se decide el respaldo.
 *
 * `<img>` Y NO `next/image`, por dos motivos que se suman:
 *
 *  · **el SVG**, que es el formato natural de un logo y el que L1 abrió: el optimizador
 *    de Next lo rechaza salvo activando `images.dangerouslyAllowSVG`, que sería una
 *    relajación GLOBAL para todo el sitio a cambio de una sola imagen;
 *  · **no hay nada que optimizar**: es pequeño, va a altura fija y no tiene variantes
 *    responsive. `next/image` aportaría el `remotePatterns` que hay que mantener y
 *    ningún beneficio.
 *
 * SIN RESERVA DE ESPACIO Y SIN ESTADO «CARGANDO»: la altura la fija el CSS
 * (`h-*  w-auto`), así que cualquier proporción entra sin desplazar la cabecera, y el
 * respaldo es texto que se pinta en el mismo render — no existe el instante en que la
 * cabecera está vacía.
 */
export function BrandLogo({
  mark,
  className = '',
  imgClassName = 'h-8 w-auto max-w-[180px] object-contain',
}: {
  mark: BrandMark;
  /** Clases del texto de respaldo. La imagen usa `imgClassName`. */
  className?: string;
  imgClassName?: string;
}) {
  if (mark.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ver la cabecera: SVG + tamaño fijo.
      <img src={mark.src} alt={mark.text} className={imgClassName} data-testid="brand-logo" />
    );
  }

  return (
    <span className={className} data-testid="brand-text">
      {mark.text}
    </span>
  );
}
