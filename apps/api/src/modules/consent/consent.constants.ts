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
