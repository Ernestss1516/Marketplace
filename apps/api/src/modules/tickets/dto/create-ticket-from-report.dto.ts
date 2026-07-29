import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * FLUJO (c) — abrir un hilo con el usuario reportado, desde un Report.
 *
 * **NO declara `userId`, y eso es el punto de seguridad de esta ruta.** El
 * destinatario lo resuelve el SERVIDOR leyendo el propio reporte (usuario
 * reportado → vendedor del anuncio → autor de la valoración). Si el cliente
 * pudiera elegirlo, este endpoint sería la vía para abrir un hilo "oficial", con
 * la autoridad que da venir de moderación, contra cualquiera — usando un reporte
 * ajeno como excusa.
 *
 * Al no estar declarado, el `forbidNonWhitelisted: true` del ValidationPipe
 * global RECHAZA con 400 un body que lo traiga (no lo ignora en silencio: falla
 * ruidosamente, que es mejor — un frontend que lo mandara por error se entera).
 *
 * Tampoco declara `reportId`: ese va en la URL.
 */
export class CreateTicketFromReportDto {
  @ApiProperty({ minLength: 3, maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ description: 'Primer mensaje del hilo (side STAFF)', minLength: 1, maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ description: 'Motivo (ContactReason con scope TICKET o BOTH)' })
  @IsOptional()
  @IsString()
  topicId?: string;
}
