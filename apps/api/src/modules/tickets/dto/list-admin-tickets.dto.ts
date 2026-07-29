import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TicketOrigin, TicketStatus } from '@prisma/client';

/**
 * Filtros de la bandeja de staff. Molde `ListContactMessagesDto` /
 * `ListReportsQueryDto`: page/perPage y filtros opcionales por columna.
 */
export class ListAdminTicketsDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketOrigin })
  @IsOptional()
  @IsEnum(TicketOrigin)
  origin?: TicketOrigin;

  @ApiPropertyOptional({ description: 'Filtrar por motivo (ContactReason)' })
  @IsOptional()
  @IsString()
  topicId?: string;

  /**
   * Id de agente, o uno de los dos centinelas: `me` (los míos) y `none` (sin
   * asignar). Los ids son cuid, así que nunca colisionan con esas dos palabras.
   */
  @ApiPropertyOptional({ description: "Id de agente, 'me' (los míos) o 'none' (sin asignar)" })
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 25;
}
