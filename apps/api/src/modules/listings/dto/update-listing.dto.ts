import {
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
import { Condition, PriceType, PriceUnit } from '@prisma/client';
import { LISTING_PHONE_REGEX } from '../listing-phone.constants';

export class UpdateListingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  // type (PRODUCT|SERVICE) deliberately has NO field here — it's immutable after
  // creation (RÁFAGA 1, producto/servicio): changing it would leave attributes
  // that no longer apply to the new type, same reasoning as UpdatePostDto.type.

  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;

  /// Formato del precio (RP.1). Mutable, a diferencia de `type`: cambiarlo no
  /// invalida ningún atributo, solo reetiqueta el mismo importe. Se revalida
  /// contra la categoría solo cuando llega explícitamente (o cuando cambia
  /// categoryId) — ver update() en listings.service.ts.
  @IsOptional()
  @IsEnum(PriceUnit)
  priceUnit?: PriceUnit;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  /// B2 — etiquetas por SLUG. Reemplazo COMPLETO del set, no un delta: mandar `[]`
  /// quita todas las que tuviera. Ausente ≠ vacío — si no viaja, los tags no se
  /// tocan (es lo que protege el grandfathering; ver el disparador en update()).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  province?: string;

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

  /// Igual que en create — opcional, distinto de User.phone. Cadena vacía
  /// permitida: es como el usuario deja de publicar teléfono en este anuncio.
  @IsOptional()
  @IsString()
  @Matches(LISTING_PHONE_REGEX, { message: 'Teléfono no válido' })
  phone?: string;

  /// PUERTA regla #3 — sin `@ArrayMaxSize`, igual que en `CreateListingDto` y por
  /// el mismo motivo que `tags`: el tope es un Setting y el decorador no puede
  /// leerlo. Lo aplica `ListingsService` contra `PhotoLimitsService`.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageIds?: string[];
}
