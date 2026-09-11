/**
 * COOKIES RÁFAGA 1 — LAS CONSTANTES DEL CONSENTIMIENTO.
 *
 * Ver docs/diseno-consentimiento-cookies.md §2 y §4.
 */

/**
 * LAS CATEGORÍAS QUE EXISTEN. Dos, y ninguna más.
 *
 * `esenciales` NO está aquí, y es deliberado: no se consiente, se informa. Meterla en
 * esta lista la convertiría en algo que el usuario puede aceptar o rechazar, y no lo es
 * — sin la cookie de sesión no hay login, y sin la de consentimiento no se puede
 * respetar la elección del propio usuario.
 *
 * NO HAY «analítica»: la telemetría propia no toca el terminal y va por interés
 * legítimo (D1, docs/auditoria-consentimiento-cookies.md §1.4). NO HAY «marketing»: no
 * existe un solo tercero publicitario, y `SponsoredAd` no mide nada. NO HAY
 * «preferencias»: no hay cookie de tema ni de idioma.
 *
 * **Una categoría existe cuando hay algo real que apagar.** Una categoría vacía en un
 * banner es una mentira al usuario: le hace creer que se le sigue cuando no es así. El
 * día que entre una analítica de terceros, la categoría se añade EN LA MISMA RÁFAGA que
 * la introduce — nunca antes «para dejarlo preparado», nunca después.
 */
export const CONSENT_CATEGORIES = ['terceros'] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/**
 * LA VERSIÓN DEL TEXTO CONSENTIDO.
 *
 * Vive como constante porque en RÁFAGA 1 todavía no hay texto configurable: el banner y
 * sus `Setting` llegan en la ráfaga 2, y es entonces cuando `cookiePolicyVersion` pasa a
 * ser un ajuste que el admin sube A MANO (D5, con aviso de que re-pregunta a todos).
 *
 * Ya se guarda en cada `ConsentRecord` desde hoy —y no se añade después— porque un
 * registro que no dice a QUÉ versión se consintió no sirve como prueba. Rellenarlo más
 * tarde sería inventar el dato de las filas viejas.
 */
export const CONSENT_POLICY_VERSION = '1';

/** El nombre de la cookie. Vive aquí para que backend y frontend no puedan divergir. */
export const CONSENT_COOKIE_NAME = 'mp_consent';

/** D4 — seis meses. La Guía de la AEPD admite hasta 24; éste es el punto conservador. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * El límite del endpoint público. Generoso a propósito: un usuario legítimo puede
 * cambiar de opinión varias veces seguidas en el panel, y cortarle ahí sería peor que
 * aceptar unas cuantas filas de más. Lo que corta es la escritura masiva automatizada.
 */
export const CONSENT_RATE_LIMIT = 20;
export const CONSENT_RATE_LIMIT_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// RÁFAGA 2 — EL TEXTO DEL BANNER, CONFIGURABLE POR INSTANCIA
// ---------------------------------------------------------------------------

/**
 * LAS CLAVES QUE EL ADMIN PUEDE TOCAR, Y NINGUNA MÁS.
 *
 * **LA FRONTERA, ESCRITA COMO CÓDIGO**: aquí sólo hay TEXTO y un enlace. No existe —ni
 * debe existir— una clave para «qué se bloquea», «cuántos botones tiene el banner», «si
 * el banner aparece» o «qué categorías hay». Eso es la mecánica del consentimiento, es
 * legal, y es fija. Un ajuste capaz de apagar el banner convertiría el cumplimiento en
 * una preferencia.
 *
 * Molde de `LOGO_SETTING_KEYS` (branding): un `Setting` por clave, escritos por UN solo
 * servicio, y fuera del whitelist genérico de `PATCH /admin/settings/:key`.
 */
export const COOKIE_TEXT_SETTING_KEYS = {
  title: 'cookieBannerTitle',
  body: 'cookieBannerBody',
  acceptLabel: 'cookieBannerAcceptLabel',
  rejectLabel: 'cookieBannerRejectLabel',
  moreLabel: 'cookieBannerMoreLabel',
  policyUrl: 'cookiePolicyUrl',
  version: 'cookiePolicyVersion',
} as const;

export type CookieTextField = keyof typeof COOKIE_TEXT_SETTING_KEYS;

/**
 * LOS TEXTOS POR DEFECTO — y el banner tiene que funcionar con ellos SIN que nadie los
 * toque.
 *
 * La lección ya está pagada en este repo: `videoEnabled` estaba en el whitelist del
 * backend pero NO en la semilla, así que en producción la fila no existía y la
 * funcionalidad era inalcanzable (docs/auditoria-pro-video.md §2.0). Aquí eso sería
 * peor: un banner que no aparece porque falta una fila es un incumplimiento causado por
 * un descuido de despliegue.
 *
 * Por eso estos valores son el RESPALDO EN CÓDIGO, no sólo la semilla: sin filas, el
 * banner sale igual y dice lo correcto. Mismo criterio que el tema, que cae a
 * `globals.css` cuando el backend no responde.
 */
export const COOKIE_TEXT_DEFAULTS = {
  title: 'Cookies y contenido de terceros',
  body:
    'Usamos cookies propias imprescindibles para que la plataforma funcione (tu sesión y ' +
    'poco más). Algunas páginas incluyen vídeos y mapas servidos por terceros, que ' +
    'reciben tu dirección IP: no se cargan hasta que tú lo aceptes.',
  acceptLabel: 'Aceptar',
  rejectLabel: 'Rechazar',
  moreLabel: 'Más información',
  /**
   * VACÍO A PROPÓSITO: la página de cookies llega en la RÁFAGA 3. Enlazar ahora a una
   * ruta que no existe sería servir un 404 desde el banner legal, que es peor que no
   * enlazar. Mientras esté vacío, «Más información» despliega el detalle en el propio
   * banner —que es donde vive la información que el RGPD exige ANTES de consentir— y no
   * navega a ninguna parte.
   */
  policyUrl: '',
  version: CONSENT_POLICY_VERSION,
} as const satisfies Record<CookieTextField, string>;

/** Tope de longitud por campo. El cuerpo admite más; las etiquetas de botón, poco. */
export const COOKIE_TEXT_MAX_LENGTH: Record<CookieTextField, number> = {
  title: 120,
  body: 1000,
  acceptLabel: 40,
  rejectLabel: 40,
  moreLabel: 40,
  policyUrl: 300,
  version: 32,
};

/**
 * Palabras que NO puede contener la etiqueta de RECHAZAR.
 *
 * El texto libre puede romper la legalidad por la puerta de atrás: poner «Aceptar» en
 * los dos botones deja el sistema no conforme aunque la mecánica sea impecable, y nadie
 * se daría cuenta mirando el código. Es la única validación de CONTENIDO que hay aquí, y
 * existe porque es la única que protege una obligación legal —que rechazar sea tan fácil
 * como aceptar— y no un gusto.
 */
export const REJECT_LABEL_FORBIDDEN = ['acept', 'permit', 'vale', 'de acuerdo', 'ok', 'sí'];

/** El tag de caché del frontend que se tumba al guardar. Molde de `BRANDING_CACHE_TAG`. */
export const COOKIES_CONFIG_CACHE_TAG = 'cookies-config';
