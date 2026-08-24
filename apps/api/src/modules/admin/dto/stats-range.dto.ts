import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/**
 * ESTADÍSTICAS B1 — la ventana temporal que pide el backoffice.
 *
 * TRES VALORES CERRADOS Y NO UN RANGO LIBRE. No es pereza de validación: cada valor
 * distinto es una consulta de agregación distinta sobre las tablas diarias, y dejar el
 * número abierto convierte un endpoint de lectura en una superficie donde alguien puede
 * pedir 3.650 días sobre TODOS los anuncios de un vendedor. Con tres opciones el coste
 * está acotado por construcción y además son las tres que la interfaz ofrece.
 *
 * 90 es el techo porque es la pregunta más larga que el staff se hace de verdad («¿esto
 * lleva así mucho?»); el vendedor Pro ve 30 fijos. Y encaja con la retención de 180 días
 * de las tablas diarias (`ImpressionsService.purgeOldDailyRows`): no se puede pedir una
 * ventana que la purga ya se haya llevado a medias.
 */
export const STATS_RANGE_DAYS = [7, 30, 90] as const;

export type StatsRangeDays = (typeof STATS_RANGE_DAYS)[number];

export class StatsRangeDto {
  /** Días hacia atrás. Por defecto 30, el mismo que ve el vendedor Pro. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsIn(STATS_RANGE_DAYS as unknown as number[])
  days?: StatsRangeDays;
}
