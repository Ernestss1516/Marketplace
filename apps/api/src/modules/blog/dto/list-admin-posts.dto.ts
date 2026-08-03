import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostStatus, PostType } from '@prisma/client';

export class ListAdminPostsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  // El tope era 50 y NINGÚN llamante lo respetaba: /admin/footer pide 200 para
  // poblar su selector de páginas y el sitemap pide 500. Los dos recibían un 400
  // que un `.catch` silencioso se tragaba — el selector salía vacío y el sitemap
  // sin URLs, sin un solo error a la vista. Ver docs/ci-playwright-plan.md §13.
  // 500 cubre a todos los llamantes actuales con margen; el listado paginado del
  // backoffice sigue pidiendo su PER_PAGE pequeño, así que subir el techo no
  // cambia nada de lo que ya funcionaba.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
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
