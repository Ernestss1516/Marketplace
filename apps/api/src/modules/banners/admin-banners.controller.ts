import { Body, Controller, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ListBannersDto } from './dto/list-banners.dto';

@ApiTags('Admin — Banners')
@ApiBearerAuth('access-token')
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminBannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  list(@Query() query: ListBannersDto) {
    return this.bannersService.list(query);
  }

  @Post()
  create(@Body() dto: CreateBannerDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.bannersService.create(dto, user.userId, ip);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.bannersService.update(id, dto, user.userId, ip);
  }
}
