import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_INTERVAL_DAYS, MIN_INTERVAL_DAYS } from './create-bump-schedule.dto';

/**
 * Solo se edita la CADENCIA. El anuncio no se cambia: una programación es de un anuncio
 * concreto (hay un `@@unique([listingId])`), y «moverla» a otro sería crear otra —con su
 * propio límite y su propio historial de turnos, que es justo lo que no debe mezclarse.
 */
export class UpdateBumpScheduleDto {
  @ApiPropertyOptional({ minimum: MIN_INTERVAL_DAYS, maximum: MAX_INTERVAL_DAYS })
  @IsOptional()
  @IsInt()
  @Min(MIN_INTERVAL_DAYS)
  @Max(MAX_INTERVAL_DAYS)
  intervalDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hourOfDay?: number;
}
