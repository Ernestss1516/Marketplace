import { Body, Controller, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ContactService } from './contact.service';
import { ListContactMessagesDto } from './dto/list-contact-messages.dto';
import { UpdateContactEstadoDto } from './dto/update-contact-estado.dto';
import { ReplyContactMessageDto } from './dto/reply-contact-message.dto';

@ApiTags('Admin — Mensajes de contacto')
@ApiBearerAuth('access-token')
@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.MODERATOR)
export class AdminContactMessagesController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  list(@Query() query: ListContactMessagesDto) {
    return this.contactService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id);
  }

  @Patch(':id/estado')
  updateEstado(
    @Param('id') id: string,
    @Body() dto: UpdateContactEstadoDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.contactService.updateEstado(id, dto.estado, user.userId, ip);
  }

  @Post(':id/responder')
  reply(
    @Param('id') id: string,
    @Body() dto: ReplyContactMessageDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.contactService.reply(id, dto, user.userId, ip);
  }
}
