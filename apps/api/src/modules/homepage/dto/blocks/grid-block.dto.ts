import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { HOME_ICON_NAMES, type HomeIconName } from './home-icons';
import { IsOwnStorageUrl, IsSafeContentUrl } from '../../../../common/validators/safe-url';

/**
 * Columnas admitidas. NO es un rango: son las cinco que el renderizador tiene
 * escritas como clases estáticas de Tailwind. Un 5 aquí no "casi funciona" — no
 * habría clase que aplicar, porque Tailwind purga lo que no ve escrito.
 */
export const GRID_COLUMNS = [1, 2, 3, 4, 6] as const;
export type GridColumns = (typeof GRID_COLUMNS)[number];

/**
 * Media de una celda: unión discriminada por `kind`. Mismo mecanismo que el
 * discriminador de bloques, un nivel más abajo.
 *
 * Que sean CLASES SEPARADAS y no un objeto con todos los campos opcionales es lo
 * que hace que `{ kind: 'icon', url: '...' }` se rechace: con `whitelist` +
 * `forbidNonWhitelisted`, el subtipo `icon` no conoce `url`.
 */
export abstract class BaseGridMediaDto {
  @IsIn(['image', 'icon'])
  kind!: 'image' | 'icon';
}

export class GridImageMediaDto extends BaseGridMediaDto {
  @IsIn(['image'])
  kind!: 'image';

  // Upload-only, nunca una URL pegada — igual que toda imagen del proyecto.
  @IsOwnStorageUrl()
  url!: string;

  // Obligatorio: una imagen sin alt es un bloque mal formado, no un caso
  // opcional (mismo criterio que ImageBlockDto del blog).
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  alt!: string;
}

export class GridIconMediaDto extends BaseGridMediaDto {
  @IsIn(['icon'])
  kind!: 'icon';

  @IsIn(HOME_ICON_NAMES)
  name!: HomeIconName;
}

export class GridCellDto {
  // `media` OPCIONAL: una celda puede ser solo texto.
  @IsOptional()
  @ValidateNested()
  @Type(() => BaseGridMediaDto, {
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: GridImageMediaDto, name: 'image' },
        { value: GridIconMediaDto, name: 'icon' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  media?: GridImageMediaDto | GridIconMediaDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  // OPCIONAL a propósito: las señales de confianza de la portada no enlazan a
  // ningún sitio. Sin href la celda se pinta como <div>, no como enlace.
  @IsOptional()
  @IsSafeContentUrl()
  href?: string;
}

/**
 * Rejilla de tarjetas. Cubre de una vez los dos huérfanos de la portada escrita
 * a mano: las cuatro señales de confianza (icono + texto, sin enlace) y
 * cualquier rejilla de imágenes con enlace.
 */
export class GridHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['grid'])
  type!: 'grid';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsInt()
  @IsIn(GRID_COLUMNS)
  columns!: GridColumns;

  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => GridCellDto)
  items!: GridCellDto[];
}
