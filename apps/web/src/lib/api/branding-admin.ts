import { apiFetch } from './client';
import type { BrandingLogos } from './branding';

/**
 * TRES LOGOS L1 — el cliente de admin de la marca. Molde `homepage-admin.ts`.
 *
 * Las dos operaciones devuelven las TRES URLs, no sólo la zona tocada: es el mismo
 * cuerpo que `GET /branding`, así que la pantalla se repinta entera con la respuesta y
 * no hace falta una segunda petición para ver el estado real.
 */

/** Las tres zonas de marca. Espejo de `LOGO_ZONES` en el backend. */
export type LogoZone = 'public' | 'backoffice' | 'blog';

/**
 * Sube el logo de una zona. Endpoint PROPIO de marca y no el del blog ni el de portada:
 * es el único que admite SVG (mapa MIME propio del módulo) y el único de ADMIN cuyo
 * resultado se muestra en las tres zonas. Límite: 1 MB.
 */
export async function uploadBrandingLogo(
  zone: LogoZone,
  file: File,
  token: string,
): Promise<BrandingLogos> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<BrandingLogos>(`/admin/branding/logos/${zone}`, {
    method: 'POST',
    token,
    body: formData,
  });
}

/** Quita el logo de una zona: vuelve a su fallback. Idempotente. */
export function clearBrandingLogo(zone: LogoZone, token: string): Promise<BrandingLogos> {
  return apiFetch<BrandingLogos>(`/admin/branding/logos/${zone}`, {
    method: 'DELETE',
    token,
  });
}
