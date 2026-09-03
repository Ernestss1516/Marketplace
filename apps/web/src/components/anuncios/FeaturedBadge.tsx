import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * «ESTE ANUNCIO ESTÁ DESTACADO» — la etiqueta, y NADA MÁS.
 *
 * POR QUÉ ES UN COMPONENTE Y NO MARCADO SUELTO, y es literalmente la misma historia que la
 * del indicador de vídeo (ver `VideoIndicator`): este `<Badge>` estaba escrito a mano dentro
 * de `ListingCard` y copiado en `ListingCardWide`, así que las superficies que no pasan por
 * ninguna de las dos —LAS DOS TARJETAS DEL MAPA— no tenían etiqueta aunque recibían el
 * `boostScore`. En vista mapa un destacado era indistinguible de cualquier otro anuncio, y hay
 * categorías cuya vista por defecto ES el mapa: el producto que alguien ha pagado no se veía
 * por ninguna parte.
 *
 * La salida no era copiar el `<Badge>` una tercera y una cuarta vez: cuatro copias del mismo
 * marcado son cuatro sitios donde el color, el texto o el `data-testid` pueden separarse. Ahora
 * hay uno. Es exactamente el mismo defecto que el vídeo ya pagó en estas dos mismas tarjetas.
 *
 * EL CRITERIO ES `boostScore === 1` EN LAS CUATRO, y lo decide quien pinta, no este
 * componente: aquí sólo llega «píntala». Un solo signo, un solo sitio donde cambiarlo.
 *
 * Ver docs/diseno-rotacion-destacados.md §10.3.
 */
export function FeaturedBadge({
  /** Dónde se coloca dentro del contenedor `relative` de quien la usa. */
  className = 'left-2 top-2',
  /**
   * Sin la palabra «Destacado», sólo la estrella. Para miniaturas donde la píldora completa
   * no cabe —la flotante del mapa mide 56 px y el texto se saldría—. Es LA MISMA etiqueta y
   * el mismo `data-testid`: lo que cambia es cuánto ocupa, no qué dice.
   */
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <Badge
      className={`pointer-events-none absolute bg-featured text-white hover:bg-featured ${
        compact ? 'px-1 py-0.5' : ''
      } ${className}`}
      data-testid="card-destacado"
      // Con la píldora, el texto ya lo dice. En compacto no hay texto, así que el nombre
      // accesible tiene que venir de aquí o la etiqueta no existiría para un lector.
      {...(compact ? { role: 'img', 'aria-label': 'Destacado' } : {})}
    >
      {compact ? <Star className="h-3 w-3 fill-current" aria-hidden /> : 'Destacado'}
    </Badge>
  );
}
