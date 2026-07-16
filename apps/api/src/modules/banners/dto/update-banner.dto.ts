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

/**
 * A diferencia de UpdateCouponDto, TODO es editable — un banner no se
 * distribuye fuera de la app, así que cambiar título/texto/placements no
 * rompe nada externo (ver mini-diseño, H8 Bloque D fase 4).
 */
export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  text?: string;

  // Ruta relativa ("/...") o URL absoluta http/https — nunca javascript:/data:.
  // Mismo validador que Footer (url EXTERNAL) y los bloques cta/hub del blog.
  // null explícito sigue permitido (limpia el link) — IsOptional lo salta.
  @IsOptional()
  @IsSafeContentUrl()
  linkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  linkText?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BannerPlacement, { each: true })
  placements?: BannerPlacement[];

  @IsOptional()
  @IsEnum(BannerVariant)
  variant?: BannerVariant;

  @IsOptional()
  @IsBoolean()
  shareable?: boolean;

  @IsOptional()
  @IsString()
  shareText?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
