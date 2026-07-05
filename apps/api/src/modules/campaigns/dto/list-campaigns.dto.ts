import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CampaignType } from '@prisma/client';

export class ListCampaignsDto {
  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  // A diferencia de los filtros booleanos de búsqueda (donde undefined y false
  // significan lo mismo: "no filtrar"), aquí sí importa distinguir "no
  // proporcionado" (sin filtro) de "false" (solo inactivas) — se preserva
  // undefined explícitamente en vez de colapsarlo a false.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 25;
}
