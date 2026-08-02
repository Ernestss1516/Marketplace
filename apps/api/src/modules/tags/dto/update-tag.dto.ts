import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * `slug` NO está aquí a propósito: es la identidad pública del tag (viaja en la URL de
 * filtro y se indexa en Meilisearch). Cambiarlo obligaría a redirigir esas URLs y a
 * reindexar todos los anuncios que lo llevan. Renombrar se hace con `name`.
 */
export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  /** Desactivar deja de ofrecerlo y de filtrarlo; los anuncios que ya lo llevan lo
   *  conservan. No hay DELETE. */
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
