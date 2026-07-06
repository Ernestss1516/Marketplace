import { IsEnum } from 'class-validator';
import { BannerPlacement } from '@prisma/client';

/** Query de GET /banners (público) — requiere placement, a diferencia del filtro opcional del admin. */
export class ActiveBannersDto {
  @IsEnum(BannerPlacement)
  placement!: BannerPlacement;
}
