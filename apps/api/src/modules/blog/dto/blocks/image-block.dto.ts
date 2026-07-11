import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

const POSITIONS = ['left', 'center', 'right', 'full'] as const;
export type ImagePosition = (typeof POSITIONS)[number];

export class ImageBlockDto extends BaseBlockDto {
  @IsIn(['image'])
  type!: 'image';

  // Restringida a nuestro propio storage (mismo criterio que coverUrl y las
  // imágenes insertadas en el editor Markdown) — sube vía el endpoint de
  // upload del bloque (molde sponsored-ads), nunca una URL externa pegada.
  @IsOwnStorageUrl()
  url!: string;

  // Obligatorio (no opcional) — accesibilidad y SEO; un bloque de imagen sin
  // alt es un bloque mal formado, no un caso opcional.
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  alt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  @IsOptional()
  @IsIn(POSITIONS)
  position?: ImagePosition;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  width?: number;
}
