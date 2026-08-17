import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

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

  /**
   * MODERACIÓN PREVIA M1 — los anuncios de esta categoría pasan por revisión
   * antes de publicarse. SE HEREDA MONÓTONO: marcarla afecta a TODOS sus
   * descendientes y ninguno puede desmarcarse (ver
   * `resolveEffectiveRequiresReview`).
   */
  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  /** RÁFAGA 2 — [] u omitido = "no configurado" (hereda del padre / default global). */
  @IsOptional()
  @IsArray()
  @IsEnum(ListingViewMode, { each: true })
  allowedViews?: ListingViewMode[];

  @IsOptional()
  @IsEnum(ListingViewMode)
  defaultView?: ListingViewMode;

  /** RP.1/RP.2 — [] u omitido = "no configurado" (hereda del padre; si tampoco,
   * solo pago único). Override completo, no fusión — ver allowedPriceUnits en
   * schema.prisma y resolveEffectivePriceUnits en category.types.ts. */
  @IsOptional()
  @IsArray()
  @IsEnum(PriceUnit, { each: true })
  allowedPriceUnits?: PriceUnit[];
}
