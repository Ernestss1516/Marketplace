import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Mismo molde que ReorderFooterColumnsDto/ReorderCategoriesDto: el swap de 2
// elementos (flechas ↑↓) se calcula en el frontend; aquí solo se recibe la
// lista completa de {id, orden} a persistir en una transacción.
export class ReorderContactReasonItemDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  orden!: number;
}

export class ReorderContactReasonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderContactReasonItemDto)
  items!: ReorderContactReasonItemDto[];
}
