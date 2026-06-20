import { Controller, Get } from '@nestjs/common';

@Controller('favorites')
export class FavoritesController {
  @Get('health')
  health() {
    return { module: 'favorites', status: 'ok' };
  }
}
