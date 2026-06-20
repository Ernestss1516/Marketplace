import { Controller, Get } from '@nestjs/common';

@Controller('reviews')
export class ReviewsController {
  @Get('health')
  health() {
    return { module: 'reviews', status: 'ok' };
  }
}
