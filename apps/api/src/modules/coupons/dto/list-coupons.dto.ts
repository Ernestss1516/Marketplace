import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CouponRewardType } from '@prisma/client';

export class ListCouponsDto {
  @IsOptional()
  @IsEnum(CouponRewardType)
  rewardType?: CouponRewardType;

  // Preserva undefined explícitamente (no colapsar a false) — "sin filtro" y
  // "solo inactivos" son distintos. Mismo patrón que ListCampaignsDto.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 25;
}
