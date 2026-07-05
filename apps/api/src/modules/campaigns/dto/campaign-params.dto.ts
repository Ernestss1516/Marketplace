import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Parámetros del bonus para CampaignType.CREDIT_BONUS.
 * Cuando se añadan más CampaignType (ACTION_DISCOUNT, COUPON, BANNER...) este
 * DTO se convierte en la validación condicional según `type` en el service,
 * en vez de un único shape fijo.
 */
export class CampaignParamsDto {
  @IsIn(['PERCENT', 'FIXED'])
  kind!: 'PERCENT' | 'FIXED';

  @IsInt()
  @Min(1)
  value!: number;
}
