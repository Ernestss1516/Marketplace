import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() query: NotificationQueryDto) {
    return this.notifications.findByUser(user.userId, query.page ?? 1, query.perPage ?? 20);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtUser) {
    const count = await this.notifications.unreadCount(user.userId);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    await this.notifications.markRead(user.userId, id);
    return { success: true };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: JwtUser) {
    await this.notifications.markAllRead(user.userId);
    return { success: true };
  }
}
