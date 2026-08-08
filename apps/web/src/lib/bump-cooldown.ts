/**
 * UXV.1 (A2) — lectura ÚNICA del estado de cooldown del bump en el frontend.
 *
 * La ventana la define y la aplica el backend (`bump-cooldown.ts` en la API) y viaja ya
 * resuelta como `nextBumpAt`. Aquí NO se calcula ninguna ventana: solo se compara ese
 * instante con el reloj y se formatea. Antes, `MyListingCard` derivaba `bumpedAt + 24h`
 * por su cuenta (deshabilitando el botón 23 h de más) mientras `ListingOwnerActions` no
 * bloqueaba nada; las dos superficies pasan por esta función para que no puedan volver a
 * contar cosas distintas.
 */

export interface BumpCooldown {
  /** true si el backend rechazaría un bump ahora mismo. */
  active: boolean;
  /** Instante en que vuelve a poder bumpearse, o null si nunca se bumpeó. */
  until: Date | null;
}

/** Estado de cooldown a partir del `nextBumpAt` servido por la API. */
export function resolveBumpCooldown(
  nextBumpAt: string | null | undefined,
  now: Date = new Date(),
): BumpCooldown {
  if (!nextBumpAt) return { active: false, until: null };
  const until = new Date(nextBumpAt);
  if (Number.isNaN(until.getTime())) return { active: false, until: null };
  return { active: until > now, until };
}

/** Texto del `title` del botón mientras el cooldown está activo. Fecha REAL, no derivada. */
export function bumpCooldownTitle(until: Date): string {
  return `Disponible el ${new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(until)}`;
}
