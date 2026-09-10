import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * E10 — UN RECHAZO CUYO TEXTO ESTÁ ESCRITO PARA LEERSE, Y LO DICE.
 *
 * ── QUÉ PROBLEMA RESUELVE ────────────────────────────────────────────────────────────
 *
 * Desde E10 el backoffice **no pinta el `message` del servidor** (ver
 * `mensajeDeErrorAdmin`): enseña el contexto, el código y un motivo derivado del código.
 * Eso cierra la vía por la que un valor de configuración interpolado en un `throw`
 * acabaría en una pantalla — pero se lleva por delante los mensajes que sí estaban
 * escritos para la persona que tiene el formulario delante:
 *
 *     throw new BadRequestException('Una ruta interna debe empezar por "/"');
 *
 * Ese texto es exactamente lo que el admin necesita leer, y «los datos enviados no son
 * válidos (400)» no lo sustituye: le dice que algo está mal y no cuál de los seis campos.
 *
 * ── LA SOLUCIÓN ES LA QUE YA TENÍA EL PROYECTO, NO UNA NUEVA ────────────────────────
 *
 * `reasons` — el canal de la PUERTA de anuncios (`ListingGateException`). La idea que lo
 * hace seguro no es el texto, es **quién lo marca**: `message` lo llena cualquier `throw`
 * de cualquier módulo, mientras que `reasons` sólo aparece cuando alguien decidió
 * explícitamente que ese texto se enseña. El frontend ya lo pinta tal cual y no hubo que
 * tocarlo (`toGateMessage`, y `mensajeDeErrorAdmin` lo consulta primero).
 *
 * Esto es lo mismo para el resto de la aplicación: un `HttpException` normal, con el
 * mismo `message` de siempre para quien sólo lea eso, más la marca.
 *
 * ── CUÁNDO USARLO, Y CUÁNDO NO ──────────────────────────────────────────────────────
 *
 *  · **SÍ** cuando el texto lo has escrito tú para que alguien lo lea y actúe: «una ruta
 *    interna debe empezar por /», «ya existe una categoría con ese slug».
 *  · **NO** para propagar el error de una librería, el de la base de datos, ni nada que
 *    lleve dentro una ruta de fichero, una consulta o un valor de configuración. Para eso
 *    está el `throw` de siempre: el frontend lo convertirá en un mensaje por código, que
 *    es justo lo que se quiere que pase con el texto que no ha escrito nadie.
 *
 * Que esto sea una clase con nombre —y no un parámetro más de `BadRequestException`— es a
 * propósito: marcar un texto como visible tiene que ser un acto que se ve al leer el
 * `throw`, y que se puede buscar en todo el repositorio de un `grep`.
 */
export class RechazoLegible extends HttpException {
  constructor(
    /** El texto que verá quien tenga el formulario delante. */
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    /** Código estable, por si algún día el cliente quiere ramificar sin mirar el texto. */
    code = 'RECHAZO_LEGIBLE',
  ) {
    // Misma forma que `ListingGateException`: `message` para quien sólo lee eso —incluido
    // el `.toThrow('…')` de las pruebas de servicio, que sigue funcionando igual— y
    // `reasons` como la marca de que el texto se puede enseñar.
    super({ message, code, reasons: [{ code, message }] }, status);
  }
}
