import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Apertura de un ticket por el propio usuario (flujo a).
 *
 * NO declara `internal` — las notas internas están aplazadas (§14.3) y no tienen
 * vía de escritura. Al no estar en el DTO, el `whitelist: true` +
 * `forbidNonWhitelisted: true` del ValidationPipe global (ver create-app.ts /
 * main.ts) RECHAZA con 400 cualquier intento de colarlo en el body. No hace falta
 * ninguna comprobación extra en el servicio: la defensa es la ausencia del campo.
 *
 * Tampoco declara `origin`, `userId`, `status`, `openedById` ni `linkedLabel`:
 * todos los decide el SERVIDOR. `linkedLabel` en particular se deriva del
 * título/número real de la entidad enlazada (ver TicketsService.assertLinkable),
 * nunca del cliente — si se aceptara, el snapshot podría mentir sobre a qué
 * apunta el ticket.
 */
export class CreateTicketDto {
  @ApiProperty({ description: 'Asunto del ticket', minLength: 3, maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ description: 'Primer mensaje del hilo', minLength: 1, maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  /**
   * FK a ContactReason. Existencia, `activo` y `scope` (TICKET o BOTH, nunca
   * PUBLIC-only) se validan en el servicio — requieren consulta a BD, fuera del
   * alcance de class-validator. Mismo reparto que `CreateContactMessageDto.motivoId`.
   */
  @ApiPropertyOptional({ description: 'Motivo (ContactReason con scope TICKET o BOTH)' })
  @IsOptional()
  @IsString()
  topicId?: string;

  // --- Enlace a UNA entidad del marketplace (excluyentes entre sí) ---
  // La PROPIEDAD de cada una la valida el servicio (assertLinkable): un anuncio
  // propio, una valoración escrita o recibida, o una factura propia.

  @ApiPropertyOptional({ description: 'Anuncio propio sobre el que va el ticket' })
  @IsOptional()
  @IsString()
  listingId?: string;

  @ApiPropertyOptional({ description: 'Valoración escrita o recibida por el usuario' })
  @IsOptional()
  @IsString()
  reviewId?: string;

  @ApiPropertyOptional({ description: 'Factura propia' })
  @IsOptional()
  @IsString()
  invoiceId?: string;
}
