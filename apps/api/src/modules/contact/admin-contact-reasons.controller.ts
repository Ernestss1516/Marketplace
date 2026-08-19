import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ContactReasonsService } from './contact-reasons.service';
import { CreateContactReasonDto } from './dto/create-contact-reason.dto';
import { UpdateContactReasonDto } from './dto/update-contact-reason.dto';
import { ReorderContactReasonsDto } from './dto/reorder-contact-reasons.dto';

@ApiTags('Admin — Motivos de contacto')
@ApiBearerAuth('access-token')
@Controller('admin/contact-reasons')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.MODERATOR)
export class AdminContactReasonsController {
  constructor(private readonly contactReasonsService: ContactReasonsService) {}

  @Get()
  listAll() {
    return this.contactReasonsService.listAll();
  }

  @Post()
  create(@Body() dto: CreateContactReasonDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.contactReasonsService.create(dto, user.userId, ip);
  }

  // Ruta estática reorder ANTES de :id — mismo gotcha ya documentado en
  // FooterAdminController/AdminController (categories/reorder).
  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  reorder(@Body() dto: ReorderContactReasonsDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.contactReasonsService.reorder(dto, user.userId, ip);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContactReasonDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.contactReasonsService.update(id, dto, user.userId, ip);
  }
}
