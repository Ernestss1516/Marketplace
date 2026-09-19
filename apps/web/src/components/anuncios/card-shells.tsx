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

/**
 * `sizes` de la foto en REJILLA: 2 columnas en móvil, 3 en tableta, 4 desde 768 px.
 *
 * ─── DECÍA 33vw HASTA 1024 px, Y LA REJILLA YA ESTÁ A 4 COLUMNAS DESDE 768 ──────────────
 *
 * Las dos rejillas que usan esta tarjeta —la lista de resultados y el bloque de
 * destacados— son `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`, o sea que los saltos están
 * en **640 y 768**, no en 640 y 1024. Entre 768 y 1024 el navegador pedía la imagen de una
 * columna de 33vw para pintarla en una de 25vw: **una imagen un tercio más grande de la
 * necesaria**, descargada y decodificada para nada, en el tramo de tabletas apaisadas y
 * portátiles pequeños.
 *
 * Era un defecto PREEXISTENTE —no lo trajo el bloque de dos filas—, pero éste es el momento
 * de arreglarlo: el bloque pasó de cuatro imágenes a ocho, así que lo que antes se pagaba
 * cuatro veces ahora se paga ocho, y todas por encima del pliegue.
 *
 * ─── LOS DECIMALES NO SON UN TIC ────────────────────────────────────────────────────────
 *
 * `sm:` de Tailwind es `min-width: 640px`, así que a 640 exactos ya hay 3 columnas. Un
 * `max-width: 640px` incluiría ese ancho en el tramo de 2 columnas y pediría el doble justo
 * en el salto. `639.98px` es la forma canónica de decir «hasta justo antes de 640».
 *
 * ─── Y DESDE 1024 SE DESCUENTA LA BARRA DE FILTROS ──────────────────────────────────────
 *
 * Ahí entra la barra lateral (`lg:w-64` = 256 px, más `gap-6` = 24 px), así que la columna
 * de resultados no es el ancho de la ventana: una tarjeta mide ~169 px a 1024 px y ~233 a
 * 1280, cuando `25vw` prometía 256 y 320. Descontarlos acerca la petición a lo que de
 * verdad se pinta. Por encima de 1536 el contenedor deja de crecer y `25vw` vuelve a
 * pasarse — hacia arriba, que es el lado seguro: una imagen de más resolución se ve bien,
 * una de menos se ve borrosa.
 */
export const GRID_MEDIA_SIZES =
  '(max-width: 639.98px) 50vw, (max-width: 767.98px) 33vw, (max-width: 1023.98px) 25vw, calc(25vw - 78px)';

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
