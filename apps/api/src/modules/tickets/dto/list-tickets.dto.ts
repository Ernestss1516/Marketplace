import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Paginación de "mis tickets". Molde `ListContactMessagesDto` (page/perPage +
 * $transaction([findMany, count])), no cursor: es una LISTA corta y ordenable
 * por último movimiento, no un hilo infinito.
 *
 * NO hay campo `userId`: el scope viene del JWT y no existe parámetro donde
 * colar el de otro. Es la primera capa del owner-scope.
 */
export class ListTicketsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number = 20;
}
