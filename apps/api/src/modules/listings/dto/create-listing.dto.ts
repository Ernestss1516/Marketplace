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
import { Condition, ListingType, PriceType } from '@prisma/client';
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

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

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
