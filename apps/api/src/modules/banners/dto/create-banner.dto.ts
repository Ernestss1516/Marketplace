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
import { IsSafeContentUrl } from '../../../common/validators/safe-url';

export class CreateBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  // Ruta relativa ("/...") o URL absoluta http/https — nunca javascript:/data:.
  // Mismo validador que Footer (url EXTERNAL) y los bloques cta/hub del blog.
  // Ver common/validators/safe-url.ts.
  @IsOptional()
  @IsSafeContentUrl()
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
