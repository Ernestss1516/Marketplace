import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
