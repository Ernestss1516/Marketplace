import { Star, TrendingUp } from 'lucide-react';
import { resolveBumpCooldown } from '@/lib/bump-cooldown';

/**
 * UXV.4 — el ESTADO de promoción de un anuncio, en un solo bloque.
 *
 * Antes era un caso suelto: una línea condicional con `featuredUntil` incrustada entre los
 * datos del anuncio. Aquí pasa a ser una ZONA, y la diferencia importa para lo que viene:
 * cuando llegue el BUMP AUTOMÁTICO (proyecto 2), «Próximo bump: martes a las 9:00» es UNA
 * LÍNEA MÁS de este componente —añadir un `{scheduledBumpAt && ...}` junto a los dos que ya
 * hay— y no una reestructuración de la tarjeta. Ese es todo el enganche: la zona existe,
 * admite N líneas, y las dos superficies la comparten.
 *
 * NO se implementa aquí ningún bump programado.
 */

const fecha = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(iso));

const fechaYHora = (d: Date) =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

interface Props {
  featuredUntil?: string | null;
  /** UXV.1 — instante en que vuelve a poder subirse, servido por la API. */
  nextBumpAt?: string | null;
  className?: string;
}

export function PromotionStatus({ featuredUntil, nextBumpAt, className }: Props) {
  const { active: enCooldown, until } = resolveBumpCooldown(nextBumpAt);

  // Sin nada que contar no se pinta el bloque: un anuncio recién publicado no tiene estado
  // promocional y no debe cargar con un hueco vacío.
  if (!featuredUntil && !enCooldown) return null;

  return (
    <div className={`space-y-0.5 ${className ?? ''}`} data-testid="estado-promocion">
      {featuredUntil && (
        <p className="flex items-center gap-1 text-xs font-medium text-amber-600">
          <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
          Destacado hasta {fecha(featuredUntil)}
        </p>
      )}
      {enCooldown && until && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
          Podrás volver a subirlo el {fechaYHora(until)}
        </p>
      )}
      {/* AQUÍ va «Próximo bump: …» cuando llegue el bump automático. */}
    </div>
  );
}
