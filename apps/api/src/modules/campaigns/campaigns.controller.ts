import { Body, Controller, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

/** H8 Bloque D — motor de campañas. ADMIN-only: es dinero regalado, decisión de plataforma. */
@ApiTags('Admin — Campaigns')
@ApiBearerAuth('access-token')
@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Query() query: ListCampaignsDto) {
    return this.campaignsService.list(query);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.campaignsService.create(dto, user.userId, ip);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.campaignsService.update(id, dto, user.userId, ip);
  }
}
