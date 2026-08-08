/**
 * UXV.3 (A7-flujo) — la intención con la que el usuario salió a comprar, para poder
 * devolverlo a ella después.
 *
 * EL PROBLEMA: quien llega a `/mis-creditos` porque no le llegaba el saldo para bumpear o
 * destacar UN anuncio concreto, pierde el hilo por el camino: paga, vuelve del TPV a una
 * página de éxito que no sabe nada, y tiene que reconstruir a mano dónde estaba.
 *
 * POR QUÉ VIAJA POR AQUÍ Y NO EN LA URL DEL FRONTEND: entre el clic y la vuelta hay un
 * salto al TPV de Redsys. Lo único que sobrevive a ese salto es lo que se firma en el
 * formulario, y `DS_MERCHANT_URLOK` lo construye el servidor. Así que el destino de
 * vuelta se manda al crear el checkout y se cuelga de esa URL.
 *
 * POR QUÉ SE VALIDA CON ALLOWLIST Y NO CON «que empiece por /»: esto es un destino de
 * redirección que llega del cliente y acaba dentro de una petición de pago firmada. Una
 * comprobación laxa (`startsWith('/')`) deja pasar `//evil.com`, que el navegador trata
 * como URL absoluta protocol-relative: redirección abierta de manual. Aquí solo se
 * aceptan las formas EXACTAS que el producto necesita; cualquier otra cosa se descarta en
 * silencio y el usuario acaba en la página de éxito genérica, que es el peor caso
 * tolerable.
 */

/** Longitud máxima — un slug largo cabe de sobra; más que esto es ruido o ataque. */
const MAX_LENGTH = 200;

/**
 * Destinos admitidos, en forma de expresión anclada por los dos extremos:
 *  - `/mis-anuncios` — volver al listado de gestión.
 *  - `/anuncio/<slug>` — volver a la ficha del anuncio concreto, que es donde el
 *    propietario puede rematar la acción que se le quedó a medias.
 *
 * Los slugs del proyecto son `[a-z0-9-]` (ver `ListingsService.generateSlug`), así que el
 * patrón no necesita admitir nada más: ni `.`, ni `%`, ni `?`, ni `#`.
 */
const ALLOWED = [/^\/mis-anuncios$/, /^\/anuncio\/[a-z0-9][a-z0-9-]{0,120}$/];

/**
 * Devuelve el destino si es uno de los admitidos, o `null` si no lo es (o no se mandó).
 * Nunca lanza: un `returnTo` inválido NO debe tumbar un cobro que por lo demás es válido.
 */
export function sanitizeReturnTo(returnTo: string | undefined | null): string | null {
  if (!returnTo || returnTo.length > MAX_LENGTH) return null;
  return ALLOWED.some((re) => re.test(returnTo)) ? returnTo : null;
}

/**
 * Cuelga el destino de vuelta de la URL de éxito del TPV. Sin destino válido devuelve la
 * URL tal cual, así que quien llama no tiene que ramificar.
 */
export function withReturnTo(successUrl: string, returnTo: string | undefined | null): string {
  const safe = sanitizeReturnTo(returnTo);
  return safe ? `${successUrl}?volver=${encodeURIComponent(safe)}` : successUrl;
}
