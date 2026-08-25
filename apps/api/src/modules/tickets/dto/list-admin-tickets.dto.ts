import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

  /**
   * #15 — «sólo los de clientes Pro». La cola del soporte prioritario, aislable.
   *
   * BOOLEANO SIMPLE, no tri-estado como los filtros de `/admin/anuncios`: allí «los que NO
   * están en observación» es una pregunta que alguien se hace; «los tickets de los que NO
   * son Pro» no lo es — el resto de la bandeja YA es eso. Sin el parámetro, no acota.
   */
  @ApiPropertyOptional({ description: 'Sólo tickets de clientes Pro' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloPro?: boolean;

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
