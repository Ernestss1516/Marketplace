import { Prisma, UserStatus } from '@prisma/client';

/**
 * BORRADO DE CUENTAS C3 — EL GATE DE VISIBILIDAD: quién se VE.
 *
 * ── LA REGLA, Y DÓNDE VA LA LÍNEA ───────────────────────────────────────────
 *
 * **Una cuenta oculta desaparece del ESCAPARATE, no de TU HISTORIAL.**
 *
 *   · **Descubrimiento** —dónde la gente te ENCUENTRA: el perfil público, el
 *     buscador de usuarios, el listado de anuncios del vendedor, el índice de
 *     búsqueda, el matching de alertas— **se cierra**.
 *   · **Relación** —dónde alguien YA tiene trato contigo: el hilo de mensajes en
 *     el que participa, la valoración que recibió de ti, el trato que cerrasteis,
 *     la denuncia que puso— **se conserva, y no se toca**.
 *
 * Por qué la línea va ahí y no más allá: ocultar el historial **no protegería a
 * nadie**. El comprador ya leyó esos mensajes y puede volver a leerlos; lo único
 * que se conseguiría es **destruir el lado del otro**, que es exactamente lo que
 * el principio rector de todo el cuerpo prohíbe. Es el mismo razonamiento con el
 * que el schema justificó guardar un teléfono detectado: no es una divulgación
 * nueva, es un índice a algo que esa persona ya tenía delante.
 *
 * ── POR QUÉ UNA CONSTANTE Y NO EL FILTRO ESCRITO CINCO VECES ────────────────
 *
 * Porque el olvido no se ve. Es la lección que `VIGENTES` dejó escrita en
 * `reviews.service.ts`: «escribir el filtro cinco veces es cinco ocasiones de
 * olvidarlo una, y el olvido no se ve: la pantalla funciona, sólo que la
 * reputación de alguien sigue arrastrando lo que el equipo retiró». Aquí es peor,
 * porque el olvido **falla hacia el lado peligroso**: la superficie que se quede
 * sin el filtro sigue sirviendo a quien pidió irse, y nadie lo nota.
 *
 * ── POR QUÉ `SUSPENDED` SÍ SE VE ────────────────────────────────────────────
 *
 * No es un descuido. Una suspensión es **temporal** —con C4 tendrá vencimiento y
 * caducará sola—, así que esconder y volver a mostrar significaría sacar y meter
 * en el índice todos sus anuncios por una sanción que dura días. `BANNED`,
 * `ARCHIVED` y `DELETED` son permanentes o indefinidos, y ahí sí compensa.
 *
 * Y de paso esto cierra un hueco que venía de mucho antes de este cuerpo: **un
 * usuario BANNED llevaba desde siempre con su perfil y sus valoraciones
 * públicos**, porque ninguna superficie pública miraba `User.status`.
 *
 * Ver docs/diseno-borrado-cuentas.md §5.
 */

/**
 * Los estados de cuenta que el público puede encontrar.
 *
 * SIN `as const` NI `readonly`: Prisma no acepta arrays de sólo lectura en un
 * `in`, y forzarlo obligaría a copiar la lista en cada uso — que es exactamente
 * la duplicación que este fichero existe para evitar.
 */
export const ESTADOS_EN_ESCAPARATE: UserStatus[] = [UserStatus.ACTIVE, UserStatus.SUSPENDED];

/**
 * El fragmento de `where` que filtra por la propia tabla `User`.
 *
 * Se compone con lo demás (`{ slug, ...CUENTA_EN_ESCAPARATE }`) o se cuelga de la
 * relación cuando se filtra desde otra tabla (`{ seller: CUENTA_EN_ESCAPARATE }`,
 * `{ user: CUENTA_EN_ESCAPARATE }`) — el nombre de la relación cambia según el
 * modelo, y por eso lo pone el llamante y no esta constante.
 */
export const CUENTA_EN_ESCAPARATE: Prisma.UserWhereInput = {
  status: { in: ESTADOS_EN_ESCAPARATE },
};
