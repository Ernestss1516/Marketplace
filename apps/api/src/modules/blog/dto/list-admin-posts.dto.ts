import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostStatus } from '@prisma/client';

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
}
