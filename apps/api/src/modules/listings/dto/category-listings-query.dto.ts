import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CategoryListingsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 24;

  @IsOptional()
  @IsIn(['publishedAt:desc', 'price:asc', 'price:desc'])
  sort?: string = 'publishedAt:desc';
}
