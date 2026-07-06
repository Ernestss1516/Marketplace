import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BannerPlacement, BannerVariant } from '@prisma/client';

export class CreateBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  linkText?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BannerPlacement, { each: true })
  placements!: BannerPlacement[];

  @IsOptional()
  @IsEnum(BannerVariant)
  variant?: BannerVariant;

  @IsOptional()
  @IsBoolean()
  shareable?: boolean;

  /** Solo tiene efecto si shareable=true; si es null se comparte `text`. */
  @IsOptional()
  @IsString()
  shareText?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
