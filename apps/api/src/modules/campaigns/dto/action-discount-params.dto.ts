import { IsIn, IsInt, Max, Min } from 'class-validator';

/**
 * Parámetros del descuento para CampaignType.ACTION_DISCOUNT (H8 Bloque D fase 2).
 * Tope 90%: lo gratis del todo es solo vía cuota Pro, nunca vía descuento de campaña.
 */
export class ActionDiscountParamsDto {
  @IsIn(['BUMP', 'FEATURED'])
  action!: 'BUMP' | 'FEATURED';

  @IsInt()
  @Min(1)
  @Max(90)
  percent!: number;
}
