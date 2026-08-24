/**
 * Claves de caché compartidas entre módulos.
 *
 * Vive en `infra/redis` y no dentro de un módulo de dominio a propósito: la ficha la
 * ESCRIBE `ListingsService.findBySlug` y la INVALIDA también `BillingService.bump`
 * (UXV.1/A2 — un bump cambia `bumpedAt`, del que se deriva `nextBumpAt`, así que dejar
 * la ficha cacheada 5 min haría que la superficie de la ficha y la de la tarjeta
 * discrepasen justo después de bumpear). Ninguno de los dos módulos puede importar del
 * otro sin invertir la dirección `ListingsModule → BillingModule`, así que el formato
 * de la clave no puede vivir en ninguno de los dos.
 */

/** Ficha pública de un anuncio (`ListingsService.findBySlug`, TTL 5 min). */
export const listingCacheKey = (slug: string) => `listing:${slug}`;

/**
 * TODAS las fichas cacheadas, para purgarlas de golpe.
 *
 * Existe por la fuga de la ficha pública: al estrechar el payload a una lista blanca, los
 * blobs ya guardados seguían llevando `phoneNormalized`, `lastOwnerIp`, `triage` y
 * `watched`. Arreglar la consulta no arregla lo que Redis ya tiene escrito, así que el
 * arreglo incluye purgar — y el patrón vive junto al formato de la clave porque es la MISMA
 * decisión: si mañana cambia el prefijo, las dos cosas cambian a la vez.
 */
export const LISTING_CACHE_PATTERN = 'listing:*';
