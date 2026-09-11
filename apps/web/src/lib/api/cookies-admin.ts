import { apiFetch } from './client';
import type { CookieTextConfig } from './cookies-config';

/**
 * COOKIES RÁFAGA 2 — el cliente de admin del texto del banner. Molde `branding-admin.ts`.
 *
 * SEPARADO de `cookies-config.ts` por el motivo de siempre en este repo: aquél importa
 * `unstable_cache`, que es sólo de servidor, y la pantalla de `/admin/cookies` es
 * cliente — importarlo allí rompería el build.
 */

export type { CookieTextConfig };

/**
 * El texto vigente, SIN pasar por la caché del sitio público.
 *
 * Quien va a cambiar un texto tiene que ver **el que hay ahora**, no el que la caché
 * sirva durante la hora siguiente. Mismo argumento que `getBrandingLive`.
 */
export function getCookiesConfigLive(token: string): Promise<CookieTextConfig> {
  return apiFetch<CookieTextConfig>('/admin/cookies-config', { token });
}

/**
 * Guarda los campos que hayan cambiado.
 *
 * PARCIAL: se manda sólo lo tocado. Mandarlo todo haría que corregir una errata
 * reescribiera también `version`, que es justamente el campo que no debe moverse por
 * accidente (subirlo vuelve a preguntar a toda la base de usuarios).
 */
export function updateCookiesConfig(
  cambios: Partial<CookieTextConfig>,
  token: string,
): Promise<CookieTextConfig> {
  return apiFetch<CookieTextConfig>('/admin/cookies-config', {
    method: 'PUT',
    body: JSON.stringify(cambios),
    token,
  });
}
