/**
 * COOKIES RÁFAGA 1 — LAS CONSTANTES DEL CONSENTIMIENTO (lado navegador).
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.
 *
 * ⚠ ESTE FICHERO TIENE UN GEMELO EN EL BACKEND:
 * `apps/api/src/modules/consent/consent.constants.ts`. No hay paquete compartido en este
 * monorepo (sólo `apps/web` y `apps/api`), así que los valores están DUPLICADOS a
 * propósito y hay un test que falla si divergen —`constantes.test.ts`, que lee el
 * fichero del backend—, porque una versión distinta a cada lado significaría registrar
 * como consentida una versión del texto que el usuario nunca vio.
 */

/**
 * LAS CATEGORÍAS QUE EXISTEN. Dos, y ninguna más.
 *
 * `esenciales` no está en la lista porque no se consiente: se informa. Sin la cookie de
 * sesión no hay login, y sin la de consentimiento no se puede respetar la elección del
 * propio usuario.
 *
 * NO HAY «analítica» (la telemetría propia no toca el terminal — D1), NO HAY «marketing»
 * (no existe un solo tercero publicitario) y NO HAY «preferencias» (no hay cookie de tema
 * ni de idioma). **Una categoría vacía en un banner miente al usuario**: le hace creer
 * que se le sigue cuando no es así.
 */
export const CATEGORIAS = ['terceros'] as const;

export type Categoria = (typeof CATEGORIAS)[number];

/**
 * La versión del texto consentido. Constante en RÁFAGA 1 —el texto configurable y su
 * `Setting` llegan en la ráfaga 2, donde el admin la sube a mano (D5)—, pero ya se
 * registra desde hoy: un consentimiento que no dice a QUÉ versión se dio no sirve como
 * prueba, y rellenarlo después sería inventar el dato de las filas viejas.
 */
export const VERSION_TEXTO = '1';

export const NOMBRE_COOKIE = 'mp_consent';

/** D4 — seis meses. La Guía de la AEPD admite hasta 24; éste es el punto conservador. */
export const MAX_AGE_SEGUNDOS = 60 * 60 * 24 * 180;

/**
 * Los terceros que el gate retiene hoy. **Esta lista es documentación viva**: es lo que
 * la página de cookies (ráfaga 3) tiene que declarar, y lo que los tests de red
 * comprueban que no se contacta sin consentimiento.
 *
 * `youtube-nocookie` está aquí aunque no escriba cookies de seguimiento al cargar: sigue
 * recibiendo la IP, el referer y el user-agent, y **el play no es interceptable** desde
 * fuera del iframe (D-nueva-1).
 */
export const DOMINIOS_RETENIDOS = [
  'player.vimeo.com',
  'www.youtube-nocookie.com',
  'api.maptiler.com',
] as const;
