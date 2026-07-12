// RÁFAGA 4 — mecanismo único de "requiere login" con retorno. Este archivo no
// lleva 'use client'/'use server': son funciones puras de string, usables
// tanto desde Server Components (redirect()) como Client Components
// (useRequireAuth) y desde middleware.ts (Edge runtime).

export const DEFAULT_CALLBACK_URL = '/mis-anuncios';

/**
 * True solo para una ruta interna del propio sitio — nunca una URL absoluta
 * ni protocol-relative (`//host`, que el navegador resuelve como otro
 * origen). Es la única puerta contra un open-redirect vía `?callbackUrl=`:
 * un enlace a `/login?callbackUrl=https://evil.com` (o `//evil.com`) no debe
 * poder mandar al usuario, ya logueado, a un sitio ajeno.
 */
export function isSafeCallbackUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  if (!url.startsWith('/')) return false;
  if (url.startsWith('//')) return false;
  if (url.startsWith('/\\')) return false;
  return true;
}

/** Construye `/login?callbackUrl=...`, cayendo al destino por defecto si el
 * path recibido no es una ruta interna segura. */
export function buildLoginUrl(callbackUrl: string): string {
  const safe = isSafeCallbackUrl(callbackUrl) ? callbackUrl : DEFAULT_CALLBACK_URL;
  return `/login?callbackUrl=${encodeURIComponent(safe)}`;
}

/** Para /login, /registro y /admin/login: el callbackUrl ya viene del query
 * param (input del atacante en potencia) — nunca usarlo sin pasar por aquí
 * primero. `fallback` permite un destino por defecto distinto del público
 * (p. ej. /admin/login cae a '/admin', no a DEFAULT_CALLBACK_URL). */
export function resolveCallbackUrl(raw: string | null, fallback: string = DEFAULT_CALLBACK_URL): string {
  return isSafeCallbackUrl(raw) ? raw : fallback;
}
