import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Mismo molde que ReorderCategoriesDto (admin/dto/reorder-categories.dto.ts):
// el swap de 2 elementos se calcula en el frontend (flechas ↑↓); aquí solo se
// recibe la lista completa de {id, order} a persistir en una transacción.
export class ReorderFooterColumnItemDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderFooterColumnsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderFooterColumnItemDto)
  items!: ReorderFooterColumnItemDto[];
}
