import { Controller, Get } from '@nestjs/common';

@Controller('listings')
export class ListingsController {
  @Get('health')
  health() {
    return { module: 'listings', status: 'ok' };
  }
}
