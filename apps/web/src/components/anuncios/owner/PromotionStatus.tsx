import Link from 'next/link';
import { CalendarClock, PauseCircle, Star, TrendingUp } from 'lucide-react';
import { resolveBumpCooldown } from '@/lib/bump-cooldown';
import { estadoProgramacion, type BumpScheduleSummary } from '@/lib/api/bump-schedules';

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
  /**
   * Bump automático — la programación de este anuncio, si la tiene. Solo llega en la
   * superficie de PROPIETARIO: es información privada del vendedor y no viaja en el payload
   * público de la ficha.
   */
  bumpSchedule?: BumpScheduleSummary | null;
  className?: string;
}

export function PromotionStatus({ featuredUntil, nextBumpAt, bumpSchedule, className }: Props) {
  const { active: enCooldown, until } = resolveBumpCooldown(nextBumpAt);
  const programacion = bumpSchedule ? estadoProgramacion(bumpSchedule) : null;

  // Sin nada que contar no se pinta el bloque: un anuncio recién publicado no tiene estado
  // promocional y no debe cargar con un hueco vacío.
  if (!featuredUntil && !enCooldown && !programacion) return null;

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
      {/*
        El hueco que UXV.4 dejó reservado, ya ocupado.

        UNA PAUSA SE VE, Y DICE POR QUÉ. Si una programación parada se pintara igual que una
        activa —o no se pintara— el usuario creería que sus bumps siguen corriendo. Es el
        mismo defecto que UXV.6/M12 cerró con la cuota Pro: al agotarse desaparecía, y «no la
        tengo» se veía idéntico a «ya la gasté». Cada razón trae además su salida cuando la
        hay: sin saldo se recarga; con el anuncio inactivo, lo que toca es reactivarlo.
      */}
      {programacion && (
        <p
          className={`flex flex-wrap items-center gap-1 text-xs ${
            programacion.activa ? 'text-muted-foreground' : 'font-medium text-amber-600'
          }`}
          data-testid="estado-bump-programado"
        >
          {programacion.activa ? (
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <PauseCircle className="h-3 w-3 shrink-0" aria-hidden />
          )}
          {programacion.texto}
          {programacion.accion && (
            <Link href={programacion.accion.href} className="underline hover:text-foreground">
              {programacion.accion.label}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
