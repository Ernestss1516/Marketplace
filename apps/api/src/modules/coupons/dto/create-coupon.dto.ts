import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CouponRewardType } from '@prisma/client';

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @IsEnum(CouponRewardType)
  rewardType!: CouponRewardType;

  /**
   * Requerido cuando rewardType=CREDITS. Que NO se envíe cuando rewardType=FEATURED
   * se comprueba en CouponsService (class-validator no expresa bien "prohibido si X"
   * de forma declarativa, solo "requerido si X" vía @ValidateIf).
   */
  @ValidateIf((o: CreateCouponDto) => o.rewardType === CouponRewardType.CREDITS)
  @IsInt()
  @Min(1)
  creditAmount?: number;

  /** Requerido cuando rewardType=FEATURED — ver nota de creditAmount arriba. */
  @ValidateIf((o: CreateCouponDto) => o.rewardType === CouponRewardType.FEATURED)
  @IsInt()
  @Min(1)
  featuredDurationDays?: number;

  /** Requerido cuando rewardType=BUMP — ver nota de creditAmount arriba. */
  @ValidateIf((o: CreateCouponDto) => o.rewardType === CouponRewardType.BUMP)
  @IsInt()
  @Min(1)
  bumpAmount?: number;

  /** Omitido o null = ilimitado. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
