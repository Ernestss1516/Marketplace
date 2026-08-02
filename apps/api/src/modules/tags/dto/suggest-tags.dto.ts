import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * B4 — parámetros del buscador de sugerencias de la portada.
 *
 * `q` NO se valida contra ningún formato: es lo que el usuario está tecleando, con sus
 * acentos, espacios y erratas. Lo único que se acota es la LONGITUD, para que un
 * parámetro absurdo no llegue a la consulta.
 */
export class SuggestTagsDto {
  @ApiPropertyOptional({ description: 'Texto tecleado. Vacío + categoría = sus etiquetas.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Slug de categoría; acota el vocabulario sugerido.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 8;
}
