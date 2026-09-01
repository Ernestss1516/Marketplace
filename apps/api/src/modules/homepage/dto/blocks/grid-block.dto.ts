import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDefined,
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

/**
 * REJILLA FLEXIBLE (ajuste 6) — se invirtió qué es obligatorio en una celda.
 *
 * ANTES: `title` obligatorio, `media` opcional. O sea que una celda podía ser texto suelto
 * pero no podía ser sólo una imagen — justo al revés de lo que una rejilla de tarjetas pide.
 * AHORA: **`media` obligatorio, todo lo demás opcional**. Una celda necesita algo visual (una
 * imagen o un icono) y nada más.
 *
 * LOS DOS CAMBIOS NO TIENEN EL MISMO RIESGO, y conviene no tratarlos igual:
 *
 *  · `title` obligatorio → opcional es **ADITIVO**: lo que ya está guardado lo tiene, sigue
 *    siendo válido, y lo único que se abre son formas nuevas. No puede romper nada.
 *  · `media` opcional → obligatorio es un **ENDURECIMIENTO**, y sí puede rechazar datos que
 *    hoy son válidos. Comprobado antes de hacerlo: ni las semillas (`seed.ts`,
 *    `seed-test.ts`, `e2e/helpers/portada.ts` — las cuatro señales de confianza llevan icono)
 *    ni la base de datos de desarrollo tienen ni una celda sin media. Pero el editor **sí
 *    ofrecía** crearlas («Sin imagen ni icono»), así que una portada en producción podría
 *    tenerlas.
 *
 * QUÉ PASA SI EXISTE UNA, dicho explícitamente: `PATCH /admin/homepage` es un reemplazo
 * completo, así que ese guardado se rechaza entero hasta que esa celda tenga imagen o icono.
 * Se ha mitigado por los dos lados — el editor ya no permite crearlas y marca en rojo la que
 * encuentre, y el mensaje del 400 nombra la celda—, pero el renderizador **sigue tratando
 * `media` como si pudiera faltar**: endurecer el DTO no borra lo ya guardado, y una portada
 * que reventara al pintar sería mucho peor que un guardado que hay que arreglar una vez.
 */
export class GridCellDto {
  /**
   * Lo ÚNICO obligatorio de una celda. `@IsDefined()` no sobra:
   * `@ValidateNested()` sobre `undefined` no valida nada y no da error.
   */
  @IsDefined({ message: 'Cada tarjeta de la rejilla necesita una imagen o un icono.' })
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
  media!: GridImageMediaDto | GridIconMediaDto;

  /**
   * OPCIONAL desde el ajuste 6. Una tarjeta puede ser sólo una imagen —un logo, una pieza
   * gráfica que ya lleva su texto dentro— y obligar a ponerle un pie forzaba a inventarlo.
   *
   * `@IsNotEmpty()` sigue puesto DEBAJO del `@IsOptional()`, y no es redundante: ausente es
   * válido, pero `""` no. Sin él, el editor podría guardar una cadena vacía y el
   * renderizador pintaría un hueco donde iría el texto — que es exactamente lo que este
   * ajuste quiere quitar.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

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
