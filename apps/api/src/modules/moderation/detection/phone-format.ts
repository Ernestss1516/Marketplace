/**
 * EL FORMATO DE UN TELÉFONO ESPAÑOL, EN UN FICHERO PURO Y ÚNICO.
 *
 * FICHERO PURO, SIN DI, por el mismo motivo que `listing-triage.ts` y `detection.types.ts`:
 * lo necesitan el detector (ModerationModule), la escritura del anuncio (ListingsModule) y
 * el filtro del backoffice (AdminModule), y esos módulos no se importan entre sí.
 *
 * ─── POR QUÉ EXISTE: UNA REGLA, NO DOS ───────────────────────────────────────────────
 *
 * Hasta ahora «qué es un teléfono español» vivía sólo dentro del patrón de `PhoneDetector`,
 * que lo RECONOCE en texto libre. Al añadir la búsqueda por teléfono hace falta además
 * CANONIZARLO —para poder comparar `654 123 456` con `+34654123456`—, y eso son dos caras de
 * la misma regla.
 *
 * Escribir la segunda por separado habría creado el problema clásico: un patrón que reconoce
 * una cosa y un normalizador que canoniza otra, divergiendo en silencio. Aquí viven juntos, y
 * hay una barrera que lo AFIRMA: **todo lo que el patrón reconoce, el normalizador lo
 * canoniza a nueve dígitos**. Si alguien toca uno y no el otro, ese test cae.
 *
 * ─── LA FORMA CANÓNICA ───────────────────────────────────────────────────────────────
 *
 * **Nueve dígitos, sin prefijo y sin separadores.** El prefijo internacional se descarta a
 * propósito: `+34 654 123 456` y `654123456` son el MISMO teléfono, y guardarlos distinto
 * haría que buscar uno no encontrara el otro — que es justamente lo que esto viene a evitar.
 *
 *     «654 123 456»      → «654123456»
 *     «+34 654-12-34-56» → «654123456»
 *     «0034654123456»    → «654123456»
 *     «12345»            → null  (no es un teléfono español)
 */

/**
 * El patrón que RECONOCE un teléfono español dentro de texto libre.
 *
 * Las tres decisiones, heredadas de `PhoneDetector` y ahora en su sitio definitivo:
 *
 *   · `(?:(?:\+|00)34[\s.\-]{0,2})?` — prefijo internacional opcional. **`34` a secas no
 *     cuenta**: aceptarlo convertiría cualquier «34 612345678» en un acierto de once
 *     dígitos, y haría que un `3` suelto delante cambiara el resultado.
 *   · `[6-9](?:[\s.\-]{0,2}\d){8}` — nueve dígitos con hasta DOS separadores entre cada par.
 *     El tope no es estética: `[\s.\-]*` sin límite invita al backtracking catastrófico sobre
 *     un texto adversarial, y esto corre dentro de una petición HTTP.
 *   · `(?<!\d)` / `(?!\d)` — que no sea un trozo de una tirada más larga. Sin ellas, un
 *     número de veinte dígitos daría un acierto por cada ventana de nueve.
 *
 * SE EXPORTA COMO FUENTE, no como `RegExp` global: `lastIndex` es estado compartido y
 * reutilizar una instancia global entre campos se saltaría hallazgos del segundo. Cada
 * consumidor construye la suya.
 */
export const ES_PHONE_SOURCE =
  String.raw`(?<!\d)(?:(?:\+|00)34[\s.\-]{0,2})?[6-9](?:[\s.\-]{0,2}\d){8}(?!\d)`;

/** Una expresión nueva por uso. Ver por qué en `ES_PHONE_SOURCE`. */
export function esPhonePattern(): RegExp {
  return new RegExp(ES_PHONE_SOURCE, 'g');
}

/**
 * Canoniza un teléfono a sus nueve dígitos. `null` si no lo es.
 *
 * Acepta lo mismo que el patrón —prefijo, separadores— porque la entrada puede venir de tres
 * sitios: el campo `Listing.phone` (lo tecleó el vendedor), el buscador del backoffice (lo
 * tecleó el moderador) y, más adelante, la lista de teléfonos bloqueados (lo tecleó el admin).
 * Ninguno de los tres tiene por qué escribirlo igual, y ése es el problema que resuelve.
 *
 * NO adivina: si tras quitar prefijo y separadores no quedan nueve dígitos empezando por 6-9,
 * devuelve `null`. Guardar una canonización a medias sería peor que no guardar nada — haría
 * casar cosas que no son el mismo número.
 */
export function normalizarTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digitos = raw.replace(/\D/g, '');

  // El prefijo se descarta por la cola: `right(9)` cubre tanto `34…` como `0034…` sin
  // tener que distinguirlos.
  const nueve =
    digitos.length === 9
      ? digitos
      : /^(?:00)?34\d{9}$/.test(digitos)
        ? digitos.slice(-9)
        : null;

  return nueve && /^[6-9]\d{8}$/.test(nueve) ? nueve : null;
}

/**
 * LOS DOS CAMPOS DEL TELÉFONO DE UN ANUNCIO, EMITIDOS JUNTOS.
 *
 * Existe para que `phone` y `phoneNormalized` **no se puedan separar por descuido**. Son dos
 * columnas y una sola verdad: la primera es lo que tecleó el vendedor —y lo que se le enseña
 * al comprador—, la segunda es esa misma cosa en forma canónica, que es lo único con lo que
 * se puede buscar.
 *
 * Escribir sólo la primera deja un anuncio **con teléfono que el buscador no encuentra**, y
 * el fallo es invisible: la pantalla del vendedor se ve perfecta y el moderador concluye que
 * ese número no está en la plataforma. Por eso no se emiten a mano en cada sitio.
 *
 * Hay una barrera que lee el fuente y comprueba que nadie escribe `phone:` sobre un `Listing`
 * sin pasar por aquí.
 */
export function camposDeTelefono(phone: string | null | undefined): {
  phone: string | null;
  phoneNormalized: string | null;
} {
  return { phone: phone ?? null, phoneNormalized: normalizarTelefono(phone) };
}
