import { IsArray, IsString } from 'class-validator';

/** Reemplaza el set PROPIO de la categoría. Los heredados no se tocan desde aquí: son
 *  del padre. Una lista vacía es válida — significa "esta categoría no ofrece ninguno". */
export class SetCategoryTagsDto {
  @IsArray()
  @IsString({ each: true })
  tagIds!: string[];
}
