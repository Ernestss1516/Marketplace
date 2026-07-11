import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Scoped a una columna (moveChild en admin/categorias): el frontend solo
// envía los ítems de la columna donde ocurrió el ↑↓, no la estructura entera.
export class ReorderFooterItemItemDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderFooterItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderFooterItemItemDto)
  items!: ReorderFooterItemItemDto[];
}
