import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  order?: number;

  @IsOptional()
  @IsArray()
  attributeSchema?: unknown[];

  @IsOptional()
  @IsEnum(ListingTypePolicy)
  allowedListingType?: ListingTypePolicy;

  /** RÁFAGA 2 — [] = "quitar la config propia" (vuelve a heredar/default global). */
  @IsOptional()
  @IsArray()
  @IsEnum(ListingViewMode, { each: true })
  allowedViews?: ListingViewMode[];

  @IsOptional()
  @IsEnum(ListingViewMode)
  defaultView?: ListingViewMode;

  /** RP.2 — [] = "quitar la config propia" (vuelve a heredar del padre / solo
   * pago único). Volver a [] siempre AMPLÍA lo permitido, así que nunca puede
   * dejar huérfano un anuncio: el guard anti-huérfanos lo deja pasar sin más. */
  @IsOptional()
  @IsArray()
  @IsEnum(PriceUnit, { each: true })
  allowedPriceUnits?: PriceUnit[];
}
