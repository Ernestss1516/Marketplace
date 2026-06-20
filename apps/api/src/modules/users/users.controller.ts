import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards';
import { JwtUser } from '../auth/auth.types';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get('me')
  getMe(@CurrentUser() user: JwtUser) {
    // TODO: return full user profile from UsersService
    return { id: user.userId, email: user.email, role: user.role };
  }
}
