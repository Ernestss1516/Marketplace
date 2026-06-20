import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get('health')
  health() {
    return { module: 'users', status: 'ok' };
  }
}
