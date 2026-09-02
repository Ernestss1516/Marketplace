import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';

/**
 * TRES LOGOS L1 — la lectura PÚBLICA de la marca.
 *
 * Las tres zonas en una sola respuesta (`GET /branding`, sin guards). `null` en una zona
 * significa «sin configurar»: el render cae al fallback de esa zona, que es cosa de L2 —
 * aquí sólo se trae el dato.
 *
 * SEPARADO DE `branding-admin.ts`, y no es sólo convención (footer/footer-admin,
 * homepage/homepage-admin): este módulo importa `unstable_cache`, que es **sólo de
 * servidor**. La pantalla de marca del backoffice es cliente, así que meter sus
 * llamadas aquí arrastraría `next/cache` a un bundle de cliente y rompería el build.
 */
export interface BrandingLogos {
  public: string | null;
  backoffice: string | null;
  blog: string | null;
}

function getBranding(): Promise<BrandingLogos> {
  return apiFetch<BrandingLogos>('/branding');
}

/**
 * El logo se pinta en TODAS las páginas de todas las zonas, así que la consulta no puede
 * correr por request. Molde exacto de `getCachedFooterNav`: UNA entrada con clave
 * constante —`GET /branding` no filtra nada, a diferencia del nav, que tiene nueve—,
 * `revalidate: 3600` como red de seguridad y no como vía principal, y el tag `branding`,
 * que `BrandingService` tumba explícitamente en cuanto un admin sube o quita un logo
 * (ver `/api/revalidate`).
 */
export const getCachedBranding = unstable_cache(() => getBranding(), ['branding'], {
  revalidate: 3600,
  tags: ['branding'],
});
