import Image from 'next/image';
import { PublicidadBadge } from './PublicidadBadge';
import {
  GridCardShell,
  WideCardShell,
  GRID_MEDIA_SIZES,
  WIDE_MEDIA_ASPECT,
  WIDE_MEDIA_SIZES,
} from './card-shells';
import type { SponsoredAdHit } from '@/types';
import type { SearchHit } from '@/lib/api/busqueda';

export function isSponsoredAdHit(hit: SearchHit): hit is SponsoredAdHit {
  return '__sponsored' in hit && hit.__sponsored === true;
}

/** Los dos formatos de tarjeta que tienen las listas de resultados. Ver `card-shells.tsx`. */
export type SponsoredCardVariant = 'grid' | 'wide';

/**
 * EL PATROCINADO INTERCALADO EN LA LISTA — mismo formato que sus vecinos, misma marca de
 * siempre.
 *
 * ── LO QUE ESTABA ROTO ───────────────────────────────────────────────────────────────
 *
 * Esta tarjeta tenía UN formato: cuadrada, foto arriba, texto debajo — el de la rejilla.
 * Pero la lista tiene DOS (`/busqueda` y `/[categoria]`: LISTA y AMPLIADA), y en AMPLIADA
 * los anuncios de arriba y de abajo son tarjetas anchas de una columna, con la foto a la
 * izquierda. El patrocinado seguía pintando su cuadrado, así que se leía como un cuerpo
 * extraño metido en la columna, no como el anuncio de al lado.
 *
 * La causa no era que faltara pasarle una variante: es que NO HABÍA variante que pasarle.
 * Ahora sí, y el molde de cada una es literalmente el mismo objeto que usan `ListingCard`
 * y `ListingCardWide` (`GridCardShell` / `WideCardShell`).
 *
 * ── LO QUE NO SE IGUALA, Y NO PUEDE IGUALARSE ────────────────────────────────────────
 *
 * La MARCA. Un patrocinado que pasara por un anuncio normal sería justo lo que no se
 * quiere:
 *
 *  · `PublicidadBadge` sobre la foto — la misma palabra y el mismo gris neutro que en el
 *    bloque «Promocionados», deliberadamente distinto del ámbar de «Destacado»;
 *  · `rel="sponsored"` en el enlace — es un enlace PAGADO y así se le dice al buscador,
 *    igual que hace el banner de portada (`AdBannerBlockRenderer`). No desplaza a los dos
 *    de seguridad, se suma a ellos: `target="_blank"` a un dominio ajeno obliga a
 *    `noopener noreferrer` (tabnabbing), y eso no es negociable por SEO ni por nada.
 */
export function SponsoredCard({
  ad,
  variant = 'grid',
}: {
  ad: SponsoredAdHit;
  /** El formato ACTIVO en la lista donde se intercala. Por defecto, la rejilla. */
  variant?: SponsoredCardVariant;
}) {
  const wide = variant === 'wide';

  const media = (
    <div
      className={`relative ${wide ? WIDE_MEDIA_ASPECT : 'aspect-square'} overflow-hidden bg-muted`}
    >
      <Image
        src={ad.imageUrl}
        alt={ad.title}
        fill
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        sizes={wide ? WIDE_MEDIA_SIZES : GRID_MEDIA_SIZES}
      />
      {/* Estilo neutro (gris), deliberadamente distinto del ámbar "Destacado"
          de ListingCard — no debe confundirse con un anuncio real destacado.
          P2B: la etiqueta se comparte ahora con el bloque «Promocionados», que hasta
          entonces no decía que fuera publicidad. Una palabra, no dos. */}
      <PublicidadBadge />
    </div>
  );

  return (
    // Enlace EXTERNO en pestaña nueva — `rel` con TRES valores y cada uno responde a algo
    // distinto: `sponsored` dice al buscador que está pagado; `noopener noreferrer` es
    // obligatorio (tabnabbing), porque a diferencia de ListingCard esto nunca navega
    // dentro del sitio.
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="sponsored noopener noreferrer"
      // `h-full` sólo en rejilla: ahí la tarjeta llena su celda, y en la columna de la
      // vista ampliada no hay celda que llenar (es exactamente lo que hace `ListingCard`
      // frente a `ListingCardWide`).
      className={`group block${wide ? '' : ' h-full'}`}
      data-testid="sponsored-card"
      data-variant={variant}
    >
      {wide ? (
        <WideCardShell media={media}>
          <p className="text-base font-semibold leading-snug">{ad.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{ad.description}</p>
        </WideCardShell>
      ) : (
        <GridCardShell media={media}>
          <p className="mb-1 line-clamp-2 text-sm font-medium leading-snug">{ad.title}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{ad.description}</p>
        </GridCardShell>
      )}
    </a>
  );
}
