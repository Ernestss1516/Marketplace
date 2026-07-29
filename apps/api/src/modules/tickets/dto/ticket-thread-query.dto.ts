import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Paginación por cursor del hilo — molde exacto de `MessagesQueryDto`. */
export class TicketThreadQueryDto {
  @ApiPropertyOptional({
    description: 'ID del mensaje cursor: devuelve los mensajes anteriores a este',
  })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({ description: 'Mensajes por página', default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
