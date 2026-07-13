import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingTypePolicy, ListingViewMode } from '@prisma/client';

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
}
