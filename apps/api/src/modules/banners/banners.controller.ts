import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BannersService } from './banners.service';
import { ActiveBannersDto } from './dto/active-banners.dto';

/** H8 Bloque D fase 4 — lectura pública, sin guard (la home es pública). */
@ApiTags('Banners')
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  list(@Query() query: ActiveBannersDto) {
    return this.bannersService.getActiveBanners(query.placement);
  }
}
