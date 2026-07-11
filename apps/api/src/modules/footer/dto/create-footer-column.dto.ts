import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateFooterColumnDto {
  // null/vacío = columna sin encabezado en el render público.
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
