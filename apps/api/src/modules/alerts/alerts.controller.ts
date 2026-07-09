import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';
import { AlertQueryDto } from './dto/alert-query.dto';

@ApiTags('Alerts')
@ApiBearerAuth('access-token')
@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateAlertDto) {
    return this.alerts.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() query: AlertQueryDto) {
    return this.alerts.findByUser(user.userId, query.page ?? 1, query.perPage ?? 20);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateAlertDto,
  ) {
    return this.alerts.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.alerts.remove(user.userId, id);
  }

  @Get(':id/matches')
  getMatches(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.alerts.getMatches(user.userId, id);
  }
}
