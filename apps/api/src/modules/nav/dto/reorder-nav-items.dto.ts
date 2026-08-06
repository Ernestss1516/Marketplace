import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Scoped a un grupo de HERMANOS (molde ReorderFooterItemsDto / moveChild de
// admin/categorias): el frontend solo envía los dos nodos que se intercambian
// tras un ↑↓, no el árbol entero. `order` es relativo a los hermanos del mismo
// padre — no hay un orden global, así que reordenar un submenú nunca afecta a
// los nodos raíz ni a los de otro menú.
export class ReorderNavItemDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderNavItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderNavItemDto)
  items!: ReorderNavItemDto[];
}
