import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RedeemCouponDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** Requerido solo si el cupón otorga un destacado (rewardType=FEATURED). */
  @IsOptional()
  @IsString()
  listingId?: string;
}
