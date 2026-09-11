/**
 * COOKIES RÁFAGA 2 — EL TEXTO POR DEFECTO DEL BANNER, sin `next/cache`.
 *
 * ─── POR QUÉ VIVE APARTE DE `lib/api/cookies-config.ts` ─────────────────────────
 *
 * Es el molde que el repo ya escribió para el tema: `lib/api/estilo.ts` importa
 * `unstable_cache` —internals de servidor de Next— y por eso la parte pura se sacó a
 * `lib/estilo-css.ts`, «porque importar ESTE módulo arrastra los internals de servidor
 * de Next, y un test en jsdom se cae con `TextEncoder is not defined` antes de ejecutar
 * una sola aserción» (`estilo.ts:59-67`).
 *
 * Aquí pasó exactamente eso, y de la misma forma: el test que compara este texto con el
 * del backend no llegaba a arrancar. La función es dato puro y tiene que ser examinable;
 * la caché vive con la llamada.
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
 * (`consent.constants.ts`) y que los de `SEED_SETTINGS`. Son tres copias con razón de
 * ser, y `constantes.test.ts` falla si alguna se desvía.
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
