import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Parámetros del bonus para CampaignType.CREDIT_BONUS. Validado manualmente en
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
