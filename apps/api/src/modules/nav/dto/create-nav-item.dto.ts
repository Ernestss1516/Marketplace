import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { NavItemType, NavPageType } from '@prisma/client';

/**
 * El DTO solo valida la FORMA de cada campo por separado. La coherencia cruzada
 * del destino —discriminado por `type`, que aquí es OPCIONAL— vive en
 * NavService.assertItemDestination, en el SERVICIO, mismo estilo que
 * FooterService/CreateFooterItemDto. Prisma no valida esa coherencia por sí
 * solo y no hay CHECK de schema.
 *
 * Diferencia con CreateFooterItemDto: `type` es opcional. Omitirlo crea un nodo
 * SOLO-DESPLEGABLE (sin destino propio, abre sus hijos). Que un nodo así deba
 * además tener hijos para servir de algo NO se valida al escribir — se poda al
 * leer, porque el padre nace siempre antes que su primer hijo (diseño §2.3).
 *
 * INTERNAL: `url` es una ruta libre — NO existe un registro de rutas reales en
 * el proyecto, así que una ruta inexistente se acepta y solo se descubre en
 * runtime como 404. Limitación heredada y aceptada del footer.
 */
export class CreateNavItemDto {
  /** null/ausente = nodo raíz (primer nivel de la barra). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentId?: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(NavItemType)
  type?: NavItemType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  /**
   * [] o ausente = SIN FILTRO, se muestra en todas las páginas. Diverge a
   * propósito de CreateBannerDto, que exige `placements` no vacío: allí un
   * banner sin ubicación es peso muerto, aquí "en todas partes" es el caso
   * mayoritario y debe ser el default (diseño §3.3).
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(NavPageType, { each: true })
  visibleOn?: NavPageType[];
}
