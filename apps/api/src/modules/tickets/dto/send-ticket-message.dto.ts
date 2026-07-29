import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Respuesta del USUARIO en su hilo.
 *
 * Un solo campo, y eso es deliberado. En particular NO declara `internal`: las
 * notas internas están aplazadas (§14.3) y, cuando lleguen, vivirán en el DTO de
 * la ruta de STAFF, nunca en esta. Al no estar declarado aquí, el
 * `forbidNonWhitelisted: true` del ValidationPipe global rechaza con 400 un body
 * que lo traiga — el servicio no necesita ignorarlo a mano.
 *
 * Tampoco declara `side`: lo congela el servicio (`replyAsUser` → USER).
 */
export class SendTicketMessageDto {
  @ApiProperty({ description: 'Contenido del mensaje', minLength: 1, maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
