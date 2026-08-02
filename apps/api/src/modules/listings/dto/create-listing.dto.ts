import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Condition, ListingType, PriceType, PriceUnit } from '@prisma/client';
import { LISTING_PHONE_REGEX } from '../listing-phone.constants';

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsEnum(ListingType)
  type!: ListingType;

  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsEnum(PriceType)
  priceType!: PriceType;

  /// Formato del precio (RP.1). OPCIONAL a propósito, a diferencia de priceType:
  /// cualquier cliente anterior a esta ráfaga que no lo envíe sigue funcionando
  /// y obtiene ONE_TIME (el default de la columna). Debe estar entre los
  /// formatos efectivos de la categoría — si no, 422 (validatePriceUnitAllowed).
  @IsOptional()
  @IsEnum(PriceUnit)
  priceUnit?: PriceUnit;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  /// B2 — etiquetas del anuncio, por SLUG (no por id): es lo que viaja en la URL de
  /// búsqueda y lo que se indexa, así que un solo identificador para las tres cosas.
  ///
  /// Aquí solo se valida la FORMA, igual que `attributes` se queda en @IsObject: qué
  /// slugs son válidos depende de la categoría (set efectivo, con herencia) y el tope
  /// depende de un Setting, así que la semántica vive en TagsService.resolveTagsForListing.
  /// Sin @ArrayMaxSize a propósito — el tope es configurable (maxTagsPerListing) y
  /// clavarlo aquí crearía un segundo sitio donde vive el mismo número.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  province!: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  /// Teléfono que se PUBLICARÁ en la ficha de este anuncio (opcional, distinto de
  /// User.phone). Sugerido por el frontend desde el perfil, nunca forzado.
  @IsOptional()
  @IsString()
  @Matches(LISTING_PHONE_REGEX, { message: 'Teléfono no válido' })
  phone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  imageIds?: string[];
}
