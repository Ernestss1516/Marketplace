import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Mismo molde que ReorderContactReasonsDto/ReorderCategoriesDto: el swap de 2 elementos
// (flechas ↑↓) se calcula en el frontend; aquí solo llega la lista {id, orden} a
// persistir en una transacción.
export class ReorderTagItemDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  orden!: number;
}

export class ReorderTagsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderTagItemDto)
  items!: ReorderTagItemDto[];
}
