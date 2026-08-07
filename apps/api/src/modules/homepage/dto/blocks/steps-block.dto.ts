import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { HOME_ICON_NAMES, type HomeIconName } from './home-icons';
import { IsSafeContentUrl } from '../../../../common/validators/safe-url';

export class StepItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;
}

export class StepsCtaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @IsSafeContentUrl()
  href!: string;
}

/**
 * Una COLUMNA de pasos, con su audiencia. Ésta es la desviación respecto al
 * bloque `steps` del blog, que es una secuencia única: la portada tiene dos
 * públicos a la vez ("Para compradores" / "Para vendedores"), cada uno con sus
 * pasos y su enlace de cierre.
 */
export class StepsColumnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  audienceTitle!: string;

  @IsOptional()
  @IsIn(HOME_ICON_NAMES)
  icon?: HomeIconName;

  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StepItemDto)
  steps!: StepItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => StepsCtaDto)
  cta?: StepsCtaDto;
}

/**
 * "Cómo funciona": N columnas de pasos numerados, una por audiencia.
 *
 * NO reusa el `steps` del blog (docs/diseno-portada.md §4.4): aquel es una
 * secuencia única y aquí hay dos niveles (título del bloque + título de columna).
 * Tampoco copia su imagen por paso — la portada no la usa y añadiría una
 * superficie de upload para nada.
 *
 * La numeración (1, 2, 3 en círculo) la pone el renderizador desde el índice; no
 * es un campo, igual que en la portada escrita a mano.
 */
export class StepsHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['steps'])
  type!: 'steps';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  // Tope 3: la rejilla del renderizador está escrita para 1, 2 o 3 columnas.
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => StepsColumnDto)
  columns!: StepsColumnDto[];
}
