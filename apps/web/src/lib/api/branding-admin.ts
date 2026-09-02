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
 * Las tres URLs, SIN pasar por la caché — y sin token: el endpoint es público.
 *
 * NO REUSA `getCachedBranding`, y no es un descuido: aquel envuelve la llamada en
 * `unstable_cache`, que es sólo de servidor, así que importarlo desde la pantalla de
 * marca (que es cliente) rompería el build. Y aunque se pudiera, no se querría: quien
 * acaba de subir un logo tiene que ver **lo que hay ahora**, no lo que la caché del
 * sitio público sirva durante los segundos siguientes.
 */
export function getBrandingLive(): Promise<BrandingLogos> {
  return apiFetch<BrandingLogos>('/branding');
}

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
