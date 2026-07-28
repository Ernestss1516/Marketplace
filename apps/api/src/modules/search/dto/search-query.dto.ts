import { ApiPropertyOptional } from '@nestjs/swagger';
import { PriceUnit } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Condition, ListingType, PriceType } from '@prisma/client';

// Only the fixed/core query params live here. Category-derived variable
// attributes (brand, fuel, sqm, itemType, …) are validated dynamically by
// search-query.parser.ts against FilterableAttributesResolver's name -> type
// map instead of a per-field decorator, so adding a filterable attribute to a
// category schema no longer requires touching this class.

export class SearchQueryDto {
  // ---------- Text ----------

  @ApiPropertyOptional({ description: 'Texto libre de búsqueda' })
  @IsOptional()
  @IsString()
  q?: string;

  // ---------- Core filters ----------

  @ApiPropertyOptional({ description: 'Slug de categoría' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ListingType, description: 'Tipo de anuncio (PRODUCT | SERVICE)' })
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @ApiPropertyOptional({ enum: Condition, description: 'Estado del artículo' })
  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @ApiPropertyOptional({ enum: PriceType, description: 'Tipo de precio' })
  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;

  @ApiPropertyOptional({ enum: PriceUnit, description: 'Formato del precio (RP.4)' })
  @IsOptional()
  @IsEnum(PriceUnit)
  priceUnit?: PriceUnit;

  @ApiPropertyOptional({ minimum: 0, description: 'Precio mínimo (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Precio máximo (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Provincia' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ description: 'Ciudad' })
  @IsOptional()
  @IsString()
  city?: string;

  // ---------- Sort & pagination ----------

  @ApiPropertyOptional({
    enum: ['price:asc', 'price:desc', 'publishedAt:desc', 'sortDate:desc'],
    description: 'Orden de resultados',
  })
  @IsOptional()
  @IsIn(['price:asc', 'price:desc', 'publishedAt:desc', 'sortDate:desc'])
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc' | 'sortDate:desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  hitsPerPage?: number = 24;

  // ---------- Proximidad ----------
  // Los tres parámetros van juntos: lat + lng + radius (km).
  // Cuando se envían, search() aplica _geoRadius como FILTRO (no como sort) y
  // ordena por _geoPoint si no hay sort explícito.
  // AVISO: los anuncios sin coordenadas (_geo ausente) quedan excluidos del
  // resultado porque Meilisearch solo incluye documentos posicionados en _geoRadius.
  // Esto es correcto: un anuncio sin posición no puede aparecer en "a X km de ti".

  @ApiPropertyOptional({
    description:
      'Latitud del punto de referencia para búsqueda por proximidad. ' +
      'Requiere lng y radius.',
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitud del punto de referencia. Requiere lat y radius.',
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Radio de búsqueda en kilómetros. Requiere lat y lng. ' +
      'Solo se incluyen anuncios con coordenadas dentro del radio.',
    minimum: 1,
    maximum: 500,
  })
  @ValidateIf((o: SearchQueryDto) => o.lat != null || o.lng != null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radius?: number;

}
