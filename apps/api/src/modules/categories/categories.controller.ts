import { Controller, Get } from '@nestjs/common';

@Controller('categories')
export class CategoriesController {
  @Get('health')
  health() {
    return { module: 'categories', status: 'ok' };
  }
}
