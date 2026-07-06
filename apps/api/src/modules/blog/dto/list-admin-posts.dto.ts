import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostStatus, PostType } from '@prisma/client';

export class ListAdminPostsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  perPage?: number;

  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  // /admin/blog?type=PAGE filtra a solo páginas informativas; sin type, incluye
  // todo (posts y páginas mezclados) — el frontend siempre pasa un type explícito
  // según qué sección admin está mostrando.
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;
}
