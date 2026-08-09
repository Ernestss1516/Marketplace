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
import { BumpScheduleCrudService } from './bump-schedule-crud.service';
import { CreateBumpScheduleDto } from './dto/create-bump-schedule.dto';
import { UpdateBumpScheduleDto } from './dto/update-bump-schedule.dto';

/**
 * API de usuario del bump automático. Todo owner-scoped: el `userId` sale SIEMPRE del token,
 * nunca del cuerpo ni de la ruta, y cada operación revalida la propiedad en el servicio.
 * Molde `AlertsController`.
 */
@ApiTags('Bump automático')
@ApiBearerAuth('access-token')
@Controller('bump-schedules')
@UseGuards(JwtAuthGuard)
export class BumpScheduleController {
  constructor(private readonly schedules: BumpScheduleCrudService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.schedules.findByUser(user.userId);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBumpScheduleDto) {
    return this.schedules.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateBumpScheduleDto,
  ) {
    return this.schedules.update(user.userId, id, dto);
  }

  @Post(':id/pausar')
  pause(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.schedules.pause(user.userId, id);
  }

  @Post(':id/reanudar')
  resume(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.schedules.resume(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.schedules.remove(user.userId, id);
  }

  /** El historial de turnos: qué se aplicó, con qué se pagó y qué se saltó. */
  @Get(':id/turnos')
  runs(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('page') page?: string,
  ) {
    return this.schedules.findRuns(user.userId, id, Number(page) || 1);
  }
}
