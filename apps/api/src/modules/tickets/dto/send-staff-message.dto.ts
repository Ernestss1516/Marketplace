import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { SendTicketMessageDto } from './send-ticket-message.dto';

/**
 * Respuesta del STAFF en un hilo. Extiende el DTO de usuario con el ÚNICO campo
 * que la administración puede usar y el usuario no: `internal`.
 *
 * **DTO SEPARADO, y esto es la defensa 4 en sí misma.** Hasta ahora las dos rutas
 * compartían `SendTicketMessageDto`; añadir `internal` allí habría abierto el
 * campo TAMBIÉN en `POST /tickets/:id/messages`, es decir, habría dejado que el
 * usuario marcase sus propios mensajes como internos. La separación es lo que
 * hace que el `forbidNonWhitelisted: true` del ValidationPipe global siga
 * rechazando con 400 un `internal` en la ruta de usuario — sin que ningún
 * `if` del servicio tenga que acordarse.
 *
 * La herencia va en la dirección segura: lo que se añada aquí NO llega al DTO de
 * usuario. Al revés sí, y por eso el campo vive en la subclase y no en la base.
 */
export class SendStaffMessageDto extends SendTicketMessageDto {
  /**
   * Nota interna: visible SOLO para el equipo, nunca para el usuario del hilo.
   * Ausente o false = mensaje normal, que sí ve el usuario.
   */
  @ApiPropertyOptional({
    description: 'Marca el mensaje como nota interna (solo visible para el staff)',
    default: false,
  })
  /**
   * R5 — un cuerpo `multipart/form-data` no tiene tipos: todo campo llega como
   * cadena, así que sin esto un `internal=true` enviado JUNTO CON un adjunto
   * fallaría el `@IsBoolean` y devolvería 400. El `Transform` convierte
   * EXACTAMENTE las dos cadenas `'true'` y `'false'`, y **nada más**: cualquier
   * otro valor (`'1'`, `'yes'`, `''`) pasa tal cual y lo sigue rechazando el
   * `@IsBoolean`. No es una relajación de la defensa 4 — `internal` sigue sin
   * existir en el DTO de usuario, que es donde vive esa defensa; deliberadamente
   * NO se usa `enableImplicitConversion` global, que habría aflojado la
   * validación de TODOS los DTO del proyecto para resolver esto.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  internal?: boolean;
}
