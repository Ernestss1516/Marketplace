import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListSponsoredAdsDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  // Preserva undefined explícitamente (no colapsar a false) — mismo patrón que ListBannersDto.
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
