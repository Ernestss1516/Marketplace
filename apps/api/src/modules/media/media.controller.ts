import { Controller, Get } from '@nestjs/common';

@Controller('media')
export class MediaController {
  @Get('health')
  health() {
    return { module: 'media', status: 'ok' };
  }
}
