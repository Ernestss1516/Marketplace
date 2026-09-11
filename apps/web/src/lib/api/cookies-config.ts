import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';
import type { CookieTextConfig } from '@/lib/consentimiento/texto-defecto';

/**
 * COOKIES RÁFAGA 2 — EL TEXTO DEL BANNER, leído por el sitio público.
 *
 * Molde exacto de `branding.ts` y `estilo.ts`. Ver docs/diseno-consentimiento-cookies.md §4.5.
 *
 * ─── EL REPARTO QUE HACE QUE TODO ENCAJE ────────────────────────────────────────
 *
 * El TEXTO es igual para todo el mundo, así que viaja en el HTML cacheado sin romper el
 * ISR ni filtrar nada de nadie. Lo único que depende del visitante es SI el banner se
 * enseña, y eso lo decide el cliente leyendo su cookie.
 *
 * Resultado: **sin fetch de cliente, sin flash y sin CLS**. El banner ya está en la
 * respuesta; lo que ocurre en el navegador es sólo decidir si se muestra.
 *
 * ─── EL VALOR POR DEFECTO NO ESTÁ AQUÍ, Y ES A PROPÓSITO ────────────────────────
 *
 * Vive en `lib/consentimiento/texto-defecto.ts`, sin `next/cache`. Este módulo arrastra
 * internals de servidor de Next, y un test en jsdom que lo importara se caería con
 * `TextEncoder is not defined` antes de ejecutar una aserción — es la cicatriz que
 * `estilo.ts:59-67` ya dejó escrita, y la volvió a morder el test que compara este texto
 * con el del backend. Se reexporta para que quien pedía las dos cosas aquí las siga
 * teniendo.
 */
export type { CookieTextConfig };
export { COOKIE_TEXT_FALLBACK } from '@/lib/consentimiento/texto-defecto';

function getCookiesConfig(): Promise<CookieTextConfig> {
  return apiFetch<CookieTextConfig>('/cookies/config');
}

/**
 * UNA entrada con clave constante —`GET /cookies/config` no filtra nada—, `revalidate:
 * 3600` como red de seguridad y no como vía principal, y el tag `cookies-config`, que el
 * backend tumba en cuanto un admin guarda. Molde literal de `getCachedBranding`.
 */
export const getCachedCookiesConfig = unstable_cache(() => getCookiesConfig(), ['cookies-config'], {
  revalidate: 3600,
  tags: ['cookies-config'],
});
