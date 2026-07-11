import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Blank/solo-espacios → null (vaciar el encabezado), nunca undefined: a
// diferencia de create, el formulario de renombrar siempre envía `name`
// (aunque quede vacío), así que no hace falta distinguir "no enviado" de
// "vaciado" — ambos casos deben persistir como columna sin encabezado.
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateFooterColumnDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
