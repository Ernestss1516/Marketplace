import { Controller, Get } from '@nestjs/common';

@Controller('search')
export class SearchController {
  @Get('health')
  health() {
    return { module: 'search', status: 'ok' };
  }
}
