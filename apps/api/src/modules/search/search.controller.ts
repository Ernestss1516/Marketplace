import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  @Get('health')
  health() {
    return { module: 'search', status: 'ok' };
  }
}
