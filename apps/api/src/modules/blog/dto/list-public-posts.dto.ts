import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListPublicPostsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  // Mismo motivo que en ListAdminPostsDto: el sitemap pide 500 a /blog y
  // /paginas, y con el tope en 50 recibía un 400 que se tragaba un `.catch`,
  // generando un sitemap SIN posts ni páginas en un proyecto que vive del SEO.
  // Ver docs/ci-playwright-plan.md §13.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  perPage?: number;

  @IsOptional()
  @IsString()
  tag?: string;
}
