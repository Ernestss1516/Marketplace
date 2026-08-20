import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PriceUnit, PriceType } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * P3a — LOS CAMPOS QUE EL STAFF PUEDE EDITAR DE UN ANUNCIO AJENO.
 *
 * LO QUE NO ESTÁ, y no es un olvido:
 *
 *   · **`status`** — cambiar el estado ya tiene su vía
 *     (`PATCH /admin/listings/:id/status`, que pasa por `elegirAccionDeEstado` y
 *     por tanto registra y avisa al vendedor). Admitirlo aquí sería una segunda
 *     puerta al mismo sitio, y reabriría exactamente el defecto que cerró M2.
 *   · **`sellerId`** — es P3b, evaluado y pospuesto (`diseno-editar-anuncio.md` §2).
 *   · **`slug`** — es la URL pública del anuncio: cambiarlo rompe enlaces e
 *     indexación. Si algún día hace falta, es otro trabajo con su redirección.
 *   · **`type`** — inmutable también para el dueño.
 *
 * Los rangos y topes son los mismos que los del DTO del dueño: el staff edita el
 * mismo anuncio con las mismas reglas, y una validación más laxa aquí produciría
 * anuncios que el propio sistema marca acto seguido — con el aviso cayéndole al
 * vendedor por un cambio que hizo el staff.
 */
export class UpdateAdminListingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Sustituye la lista completa, igual que en la edición del dueño. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  /**
   * El motivo del cambio. Va al `AuditLog`, no al anuncio: sin él, una edición de
   * staff sería indistinguible de una del dueño y el vendedor no tendría forma de
   * saber quién le cambió el anuncio.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
