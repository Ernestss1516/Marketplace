import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Parámetros del bonus — COMPARTIDO por CampaignType.CREDIT_BONUS y
 * CampaignType.BUMP_BONUS (campaña #10): mismo shape, misma fórmula de
 * acumulación (aditiva sobre la base, ver RedsysService), solo cambia la
 * moneda que otorga cada uno. Validado manualmente en
 * CampaignsService.validateParams (switch según `type`) — ver también
 * ActionDiscountParamsDto para CampaignType.ACTION_DISCOUNT.
 */
export class CampaignParamsDto {
  @IsIn(['PERCENT', 'FIXED'])
  kind!: 'PERCENT' | 'FIXED';

  @IsInt()
  @Min(1)
  value!: number;
}
