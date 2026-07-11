import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { FooterItemType } from '@prisma/client';

// "Mover de columna" = editar columnId aquí (no hay drag&drop ni endpoint
// aparte) — igual de barato que reordenar y no pierde el id del ítem.
// Mismo reparto de validación que CreateFooterItemDto: forma aquí, coherencia
// cruzada del destino en FooterService.assertItemDestination.
export class UpdateFooterItemDto {
  @IsOptional()
  @IsString()
  columnId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsEnum(FooterItemType)
  type?: FooterItemType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;
}
