/**
 * UXV.1 (A2) — FUENTE ÚNICA de la ventana de cooldown del bump.
 *
 * Antes de esta ráfaga había TRES verdades sobre "¿puedo volver a bumpear?":
 * el backend rechazaba por debajo de 3600 s (literal suelto en `BillingService.bump`),
 * `MyListingCard` deshabilitaba el botón durante 24 h (`bumpedAt + 24h`, calculado en
 * el cliente) y `ListingOwnerActions` no bloqueaba nada. Resultado: el botón de la
 * tarjeta mentía 23 horas y las dos superficies de propietario se contradecían.
 *
 * La regla vive AQUÍ y en ningún otro sitio. El backend la aplica (`BillingService.bump`)
 * y la EXPONE ya resuelta (`nextBumpAt` en el payload del anuncio del propietario y en
 * la ficha), de modo que el frontend solo compara contra `Date.now()` — nunca vuelve a
 * derivar la ventana. Cambiar la política (p. ej. cooldown por plan, cuando llegue el
 * bump automático) es cambiar este fichero, no cuatro sitios.
 */

/** Ventana mínima entre dos bumps del mismo anuncio. */
export const BUMP_COOLDOWN_SECONDS = 3600;

/**
 * Instante en que un anuncio vuelve a ser bumpeable, derivado de su último bump.
 *
 * Acepta `string` además de `Date` porque la ficha (`findBySlug`) sirve el anuncio
 * desde un blob JSON en Redis: al salir de la caché las fechas ya son ISO, no `Date`.
 *
 * Devuelve ISO (o `null` si nunca se bumpeó) para que el payload no dependa de cómo
 * serialice cada camino.
 */
export function nextBumpAt(bumpedAt: Date | string | null | undefined): string | null {
  if (!bumpedAt) return null;
  const last = bumpedAt instanceof Date ? bumpedAt : new Date(bumpedAt);
  if (Number.isNaN(last.getTime())) return null;
  return new Date(last.getTime() + BUMP_COOLDOWN_SECONDS * 1000).toISOString();
}
