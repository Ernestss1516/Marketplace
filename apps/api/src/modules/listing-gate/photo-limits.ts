/**
 * LOS LÍMITES DE FOTOS — y por qué son DOS COSAS DISTINTAS que viajan juntas.
 *
 * ─── EL MÁXIMO: una migración transparente, no una regla nueva ───────────────
 *
 * Ya existía: `@ArrayMaxSize(15)` en los dos DTOs de anuncio, más un
 * `MAX_PHOTOS = 15` en React. Tres copias del mismo número, que es exactamente
 * como divergen los números. Lo único que cambia aquí es DE DÓNDE sale: de una
 * constante a un `Setting`, con 15 por defecto. Quince sigue siendo quince, así
 * que no hay nada que apagar ni ningún anuncio que se vea afectado.
 *
 * NO PUEDE SEGUIR SIENDO UN DECORADOR. `@ArrayMaxSize` se evalúa al decorar la
 * clase, cuando no hay base de datos a la que preguntar; un tope configurable no
 * cabe ahí. El repo ya se topó con esto y lo resolvió igual: el campo `tags` del
 * DTO lleva escrito «Sin @ArrayMaxSize a propósito — el tope es configurable
 * (maxTagsPerListing) y clavarlo aquí crearía un segundo sitio donde vive el
 * mismo número». Se sigue ese molde al pie de la letra.
 *
 * ─── EL MÍNIMO: eso sí es regla nueva, y nace APAGADA ────────────────────────
 *
 * «Se necesita al menos 1 foto para publicar» lo dice la interfaz desde siempre
 * —el botón de publicar del asistente está deshabilitado sin fotos— pero el
 * backend NO lo exige: por «Mis anuncios» o por la API se publica un anuncio sin
 * ninguna. Encender esta regla ALINEA el servidor con lo que la interfaz lleva
 * años prometiendo.
 *
 * Nace apagada porque puede haber anuncios publicados con cero fotos (M2 midió
 * cero en desarrollo, pero producción es otra cosa), y encenderla sin ese número
 * delante es justo lo que el informe existe para evitar.
 */

/** Los mismos quince de siempre. */
export const DEFAULT_MAX_PHOTOS = 15;
/** Lo que la interfaz ya pide: una foto. */
export const DEFAULT_MIN_PHOTOS = 1;

export const MAX_PHOTOS_SETTING = 'maxPhotosPerListing';
export const MIN_PHOTOS_SETTING = 'minPhotosPerListing';
/** El interruptor SÓLO del mínimo. El máximo no lo necesita: ya se aplicaba. */
export const MIN_PHOTOS_RULE_ENABLED_SETTING = 'minPhotosRuleEnabled';

/** El código del motivo cuando faltan fotos para publicar. */
export const NOT_ENOUGH_PHOTOS_CODE = 'NOT_ENOUGH_PHOTOS';
