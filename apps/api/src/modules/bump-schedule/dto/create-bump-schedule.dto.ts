import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, Min } from 'class-validator';

/**
 * Límites de la frecuencia (D1).
 *
 * EL MÍNIMO ES 1 DÍA, no la hora que permitiría el cooldown. Con la ventana de 3600 s se
 * podrían encadenar 24 bumps diarios —unos 120 créditos al día al precio por defecto—, que es
 * un gasto desatendido que nadie configura a conciencia. El cooldown protege la plataforma;
 * este mínimo protege al usuario.
 */
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 30;

export class CreateBumpScheduleDto {
  @ApiProperty({ description: 'Anuncio que se subirá automáticamente.' })
  @IsString()
  listingId!: string;

  @ApiProperty({ minimum: MIN_INTERVAL_DAYS, maximum: MAX_INTERVAL_DAYS, example: 3 })
  @IsInt()
  @Min(MIN_INTERVAL_DAYS)
  @Max(MAX_INTERVAL_DAYS)
  intervalDays!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 23,
    example: 9,
    description: 'Hora del día en horario peninsular (Europe/Madrid).',
  })
  @IsInt()
  @Min(0)
  @Max(23)
  hourOfDay!: number;
}
