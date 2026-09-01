import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

// Composición de piezas ya existentes (upload de `image` + markdown de
// `text`) — cero validación nueva, solo reagrupa los mismos dos campos bajo
// un único bloque con layout. Prueba barata de que añadir un tipo estático
// es cuestión de composición, no de inventar reglas.
export class ImageTextImageDto {
  @IsOwnStorageUrl()
  url!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  alt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}

export class ImageTextBlockDto extends BaseBlockDto {
  @IsIn(['imageText'])
  type!: 'imageText';

  /**
   * `@IsDefined()` añadido al escribir `adBanner` (ajuste 5), donde se comprobó que
   * **`@ValidateNested()` sobre `undefined` no valida nada y no da error**. Sin él, este
   * campo estaba declarado obligatorio (`image!`) pero no lo era: un `imageText` sin imagen
   * se guardaba con 201 — medido — y después `ImageTextBlockRenderer` hacía
   * `block.image.url` sobre `undefined` y **tumbaba la página pública**.
   *
   * Era el único sitio con esa forma: `profile.image` y `grid.media` sí son `@IsOptional()`
   * a propósito, y sus renderizadores los tratan como tales.
   */
  @IsDefined()
  @ValidateNested()
  @Type(() => ImageTextImageDto)
  image!: ImageTextImageDto;

  @IsString()
  @MaxLength(20000)
  markdown!: string;

  @IsIn(['imageLeft', 'imageRight'])
  layout!: 'imageLeft' | 'imageRight';
}
