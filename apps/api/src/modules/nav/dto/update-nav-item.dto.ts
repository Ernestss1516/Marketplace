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
 * "Mover en el árbol" = editar `parentId` aquí; no hay endpoint aparte, igual
 * que "mover de columna" en UpdateFooterItemDto. El servicio aplica entonces
 * las dos guardas del árbol (assertMaxDepth y assertNoCycle).
 *
 * DOS campos aceptan `null` EXPLÍCITO, y la diferencia con `undefined` es
 * semántica, no cosmética (@IsOptional deja pasar ambos, y el servicio los
 * distingue con `!== undefined`):
 *   - `parentId: null`  → promover el nodo a raíz.  `undefined` → no tocar.
 *   - `type: null`      → quitarle el destino, pasa a solo-desplegable.
 *                         `undefined` → no tocar el destino.
 *
 * Mismo reparto de validación que CreateNavItemDto: la forma aquí, la
 * coherencia cruzada del destino en NavService.assertItemDestination.
 */
export class UpdateNavItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(NavItemType)
  type?: NavItemType | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  /** [] = sin filtro (se muestra en todas). Ausente = no tocar. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(NavPageType, { each: true })
  visibleOn?: NavPageType[];
}
