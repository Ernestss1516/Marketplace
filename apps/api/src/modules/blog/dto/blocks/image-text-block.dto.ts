import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
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

  @ValidateNested()
  @Type(() => ImageTextImageDto)
  image!: ImageTextImageDto;

  @IsString()
  @MaxLength(20000)
  markdown!: string;

  @IsIn(['imageLeft', 'imageRight'])
  layout!: 'imageLeft' | 'imageRight';
}
