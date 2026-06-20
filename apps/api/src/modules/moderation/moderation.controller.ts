import { Controller, Get } from '@nestjs/common';

@Controller('moderation')
export class ModerationController {
  @Get('health')
  health() {
    return { module: 'moderation', status: 'ok' };
  }
}
