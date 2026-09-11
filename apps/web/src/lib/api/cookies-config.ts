import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';

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
 * SEPARADO de un cliente de admin por el motivo de siempre: este módulo importa
 * `unstable_cache`, que es sólo de servidor, y la pantalla de `/admin/cookies` es
 * cliente — importarlo allí rompería el build.
 */
export interface CookieTextConfig {
  title: string;
  body: string;
  acceptLabel: string;
  rejectLabel: string;
  moreLabel: string;
  /** Vacío mientras no exista la página de cookies (ráfaga 3). */
  policyUrl: string;
  /** La versión del texto. Si no coincide con la de la cookie, se vuelve a preguntar (D5). */
  version: string;
}

/**
 * El respaldo del respaldo.
 *
 * El backend ya devuelve defectos cuando no hay filas, así que esto sólo entra en juego
 * si la API **no responde**. Y tiene que existir: un backend caído no puede hacer
 * desaparecer el banner legal de todas las páginas. Mismo criterio que el tema, que cae a
 * `globals.css` cuando `/estilo` falla (`layout.tsx:91-97`).
 *
 * Los valores son los mismos que `COOKIE_TEXT_DEFAULTS` en el backend
 * (`consent.constants.ts`), y hay un test que falla si divergen.
 */
export const COOKIE_TEXT_FALLBACK: CookieTextConfig = {
  title: 'Cookies y contenido de terceros',
  body:
    'Usamos cookies propias imprescindibles para que la plataforma funcione (tu sesión y ' +
    'poco más). Algunas páginas incluyen vídeos y mapas servidos por terceros, que ' +
    'reciben tu dirección IP: no se cargan hasta que tú lo aceptes.',
  acceptLabel: 'Aceptar',
  rejectLabel: 'Rechazar',
  moreLabel: 'Más información',
  policyUrl: '',
  version: '1',
};

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
