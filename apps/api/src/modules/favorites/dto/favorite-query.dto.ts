import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FavoriteQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 20;
}
