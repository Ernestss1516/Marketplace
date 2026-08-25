import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { PublicidadBadge } from './PublicidadBadge';
import type { SponsoredAdHit } from '@/types';
import type { SearchHit } from '@/lib/api/busqueda';

export function isSponsoredAdHit(hit: SearchHit): hit is SponsoredAdHit {
  return '__sponsored' in hit && hit.__sponsored === true;
}

export function SponsoredCard({ ad }: { ad: SponsoredAdHit }) {
  return (
    // Enlace EXTERNO en pestaña nueva — rel="noopener noreferrer" obligatorio
    // (tabnabbing): a diferencia de ListingCard, esto nunca navega dentro del sitio.
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block h-full"
      data-testid="sponsored-card"
    >
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <Image
            src={ad.imageUrl}
            alt={ad.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
          {/* Estilo neutro (gris), deliberadamente distinto del ámbar "Destacado"
              de ListingCard — no debe confundirse con un anuncio real destacado.
              P2B: la etiqueta se comparte ahora con el bloque «Promocionados», que hasta
              entonces no decía que fuera publicidad. Una palabra, no dos. */}
          <PublicidadBadge />
        </div>
        <CardContent className="p-3">
          <p className="mb-1 line-clamp-2 text-sm font-medium leading-snug">{ad.title}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{ad.description}</p>
        </CardContent>
      </Card>
    </a>
  );
}
