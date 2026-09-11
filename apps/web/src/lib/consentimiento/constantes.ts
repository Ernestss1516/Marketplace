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
 * La versión del texto consentido, cuando no hay ninguna publicada en el HTML.
 *
 * RÁFAGA 2 — LA VERSIÓN YA NO ES UNA CONSTANTE: la fija el admin (D5) y viaja desde el
 * servidor. Este valor es sólo el respaldo para los contextos donde no hay documento
 * (tests unitarios) o donde el HTML es anterior a esta ráfaga.
 */
export const VERSION_TEXTO_FALLBACK = '1';

/**
 * EL ATRIBUTO POR EL QUE LA VERSIÓN VIAJA DEL SERVIDOR AL CLIENTE.
 *
 * El layout raíz lo escribe en el `<body>` con el valor que el admin configuró. Cualquier
 * pieza de cliente —el banner y los gates, que son autónomos y no comparten proveedor—
 * lo lee de ahí.
 *
 * POR QUÉ UN ATRIBUTO Y NO UNA PROP: los gates viven en sitios dispersos (bloques del
 * CMS, el mapa) y no tienen un ancestro común que les pase nada; pasarles la versión de
 * uno en uno sería enhebrarla por media aplicación. Y por qué no un fetch de cliente:
 * porque el texto es igual para todos y ya está en el HTML cacheado, así que pedirlo otra
 * vez sería latencia por nada.
 *
 * NO ROMPE LA HIDRATACIÓN —que es la lección que dejó la ráfaga 1—: es un atributo que
 * escribe el servidor y que el cliente sólo lee, así que no hay nada que reconciliar.
 */
export const ATRIBUTO_VERSION = 'data-cookie-version';

/**
 * La versión vigente según el HTML servido. Cae al respaldo fuera del navegador.
 *
 * SI LA VERSIÓN CAMBIA, LA COOKIE VIEJA DEJA DE VALER — y eso vale para el banner (que
 * vuelve a preguntar) **y para el gate** (que vuelve a retener). Tiene que ser así: un
 * consentimiento dado sobre un texto anterior no cubre lo que dice el texto nuevo.
 */
export function versionVigente(): string {
  if (typeof document === 'undefined') return VERSION_TEXTO_FALLBACK;
  return document.body?.getAttribute(ATRIBUTO_VERSION) || VERSION_TEXTO_FALLBACK;
}

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
