import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingStatus } from '@prisma/client';

export class ListAdminListingsDto {
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  /**
   * MODERACIÓN M3 — orden de la lista. Omitido = el de siempre (`updatedAt desc`,
   * lo más reciente arriba), así que `/admin/anuncios` no cambia.
   *
   * `oldest` existe para LA COLA DE REVISIÓN: una cola que enseña lo más nuevo
   * primero entierra al que lleva más tiempo esperando, que es justo el que más
   * urge. En un listado de administración «lo último que se movió» es lo útil; en
   * una cola de trabajo, lo es «lo que lleva más tiempo parado».
   */
  @IsOptional()
  @IsEnum(['recent', 'oldest'])
  order?: 'recent' | 'oldest';

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
}
