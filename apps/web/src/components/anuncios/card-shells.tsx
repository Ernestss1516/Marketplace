import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * EL CHASIS DE LAS TARJETAS DE LISTA — el molde, separado de lo que va dentro.
 *
 * ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────────────
 *
 * En las listas de resultados (/busqueda y /[categoria]) conviven DOS COSAS QUE NO SON
 * LO MISMO: los anuncios reales (`ListingCard` / `ListingCardWide`) y el patrocinado
 * intercalado (`SponsoredCard`), que no es un `Listing` —no tiene precio, ni slug, ni
 * favorito, y su enlace sale del sitio—. Por eso son componentes distintos, y lo seguirán
 * siendo.
 *
 * Lo que NO tenía por qué ser distinto es el MOLDE: la caja, la proporción de la foto, la
 * columna de contenido y el gesto al pasar el ratón. Mientras cada componente escribía el
 * suyo a mano, el patrocinado se pintaba con la tarjeta cuadrada de rejilla TAMBIÉN en la
 * vista AMPLIADA —donde los anuncios de al lado son tarjetas anchas de una columna—, y
 * desentonaba: una tarjeta cuadrada suelta en una columna de tarjetas apaisadas.
 *
 * Con el molde en un sitio, «el patrocinado se ve como los demás» deja de ser una
 * coincidencia que hay que mantener a mano y pasa a ser la misma función.
 *
 * ── LO QUE EL CHASIS *NO* DECIDE ─────────────────────────────────────────────────────
 *
 * Nada de lo que hace que una tarjeta sea la que es: ni el enlace (interno con `Link` en
 * un anuncio, externo con `rel="sponsored"` en un patrocinado), ni la foto (carrusel en el
 * anuncio, imagen única en el patrocinado), ni las etiquetas superpuestas. El chasis pone
 * la caja; cada tarjeta pone su contenido y su marca.
 */

/** `sizes` de la foto en REJILLA: 2 columnas en móvil, 3 en tablet, 4 en escritorio. */
export const GRID_MEDIA_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';

/** `sizes` de la foto en AMPLIADA: ancho completo en móvil, la columna fija de 256 px arriba. */
export const WIDE_MEDIA_SIZES = '(max-width: 640px) 100vw, 256px';

/** Proporción de la foto en AMPLIADA: apaisada en móvil (arriba), cuadrada en escritorio (izquierda). */
export const WIDE_MEDIA_ASPECT = 'aspect-[4/3] sm:aspect-square';

/**
 * Vista LISTA (rejilla): foto arriba, contenido debajo, altura completa de la celda.
 *
 * `tarjeta-levanta` es el gesto compartido del ESCAPARATE C (globals.css) — el mismo que
 * ya usan las tarjetas de categoría, el hub y el blog, con su `motion-reduce` incluido.
 */
export function GridCardShell({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <Card className="tarjeta-levanta h-full overflow-hidden" data-testid="chasis-rejilla">
      {media}
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

/**
 * Vista AMPLIADA (RÁFAGA 2): una columna, tarjeta ancha — foto a la izquierda (fija en
 * escritorio, arriba en móvil) y contenido a la derecha.
 */
export function WideCardShell({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <Card
      className="overflow-hidden transition-shadow group-hover:shadow-md"
      data-testid="chasis-ampliada"
    >
      <div className="flex flex-col sm:flex-row">
        <div className="sm:w-64 sm:shrink-0">{media}</div>
        <CardContent className="flex-1 p-4">{children}</CardContent>
      </div>
    </Card>
  );
}
