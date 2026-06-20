import { Controller, Get } from '@nestjs/common';

@Controller('messaging')
export class MessagingController {
  @Get('health')
  health() {
    return { module: 'messaging', status: 'ok' };
  }
}
