import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { CATEGORIAS } from '../email-preferences.service';
import type { EmailCategory } from '../../../infra/queue/email-categories';

/**
 * NOTIFICACIONES N5 — qué categorías INFORMATIVAS quiere recibir por correo.
 *
 * Todas opcionales: se manda sólo lo que cambia, y lo ausente no se toca. No existe
 * ningún campo para las críticas — no es que se ignore, es que no hay dónde
 * escribirlo.
 */
export class UpdateEmailPreferencesDto {
  @ApiPropertyOptional({ description: 'Avisos de mensajes sin leer.' })
  @IsOptional()
  @IsBoolean()
  MESSAGES?: boolean;

  @ApiPropertyOptional({ description: 'Caducidad de anuncios y su preaviso.' })
  @IsOptional()
  @IsBoolean()
  LISTINGS?: boolean;

  @ApiPropertyOptional({ description: 'Valoraciones recibidas y peticiones de valoración.' })
  @IsOptional()
  @IsBoolean()
  REVIEWS?: boolean;

  @ApiPropertyOptional({ description: 'Coincidencias de tus alertas guardadas.' })
  @IsOptional()
  @IsBoolean()
  ALERTS?: boolean;
}

/** La baja de un clic desde el pie del correo. La firma sustituye a la sesión. */
export class UnsubscribeDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty({ enum: CATEGORIAS })
  @IsIn(CATEGORIAS)
  category!: EmailCategory;

  /** HMAC de `userId:category`. Sin el secreto del servidor no se puede forjar. */
  @ApiProperty()
  @IsString()
  signature!: string;
}
