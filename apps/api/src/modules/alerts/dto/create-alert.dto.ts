import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Condition, ListingType, PriceType } from '@prisma/client';

// Mirrors SearchQueryDto minus sort/page/hitsPerPage — an Alert has no
// presentation concerns, only match criteria. `radius` stays in km at the
// API boundary (same unit as /search) and is converted to radiusMeters in
// AlertsService before persisting.
export class CreateAlertDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // Raw string values from the URL — coerced to their real type
  // (number/boolean/string) in AlertsService before persisting. See
  // coerceAttributeValue in search-query.parser.ts.
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ValidateIf((o: CreateAlertDto) => o.lat != null || o.lng != null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radius?: number;
}
