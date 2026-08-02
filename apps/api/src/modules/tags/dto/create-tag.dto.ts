import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  /**
   * Opcional: si no llega, se deriva del nombre. Se acepta explícito porque el
   * derivado puede no ser el que el admin quiere ("4x4" → "4-4").
   * Formato cerrado: es lo que viaja en `?tags=` y lo que se indexa, así que no puede
   * llevar espacios, mayúsculas ni acentos.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug solo admite minúsculas, números y guiones (sin guiones al principio, al final ni dobles)',
  })
  slug?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}
