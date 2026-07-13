import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingTypePolicy, ListingViewMode } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

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

  /** RÁFAGA 2 — [] u omitido = "no configurado" (hereda del padre / default global). */
  @IsOptional()
  @IsArray()
  @IsEnum(ListingViewMode, { each: true })
  allowedViews?: ListingViewMode[];

  @IsOptional()
  @IsEnum(ListingViewMode)
  defaultView?: ListingViewMode;
}
