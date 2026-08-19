import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { FooterService } from './footer.service';
import { CreateFooterColumnDto } from './dto/create-footer-column.dto';
import { UpdateFooterColumnDto } from './dto/update-footer-column.dto';
import { ReorderFooterColumnsDto } from './dto/reorder-footer-columns.dto';
import { CreateFooterItemDto } from './dto/create-footer-item.dto';
import { UpdateFooterItemDto } from './dto/update-footer-item.dto';
import { ReorderFooterItemsDto } from './dto/reorder-footer-items.dto';

@ApiTags('Admin Footer')
@ApiBearerAuth('access-token')
@Controller('admin/footer')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.EDITOR)
export class FooterAdminController {
  constructor(private readonly footerService: FooterService) {}

  @Get()
  getStructure() {
    return this.footerService.adminListStructure();
  }

  // ─── Columns ────────────────────────────────────────────────────────────
  // IMPORTANTE: la ruta estática columns/reorder debe declararse ANTES de
  // columns/:id — mismo gotcha ya documentado en AdminController
  // (categories/reorder) y en el antiguo PagesController (paginas/footer).

  @Post('columns')
  @HttpCode(HttpStatus.CREATED)
  createColumn(
    @Body() dto: CreateFooterColumnDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.createColumn(dto, user.userId, ip);
  }

  @Patch('columns/reorder')
  @HttpCode(HttpStatus.OK)
  reorderColumns(
    @Body() dto: ReorderFooterColumnsDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.reorderColumns(dto, user.userId, ip);
  }

  @Patch('columns/:id')
  @HttpCode(HttpStatus.OK)
  updateColumn(
    @Param('id') id: string,
    @Body() dto: UpdateFooterColumnDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.updateColumn(id, dto, user.userId, ip);
  }

  @Delete('columns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteColumn(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.deleteColumn(id, user.userId, ip);
  }

  // ─── Items ──────────────────────────────────────────────────────────────
  // Misma regla: items/reorder ANTES de items/:id.

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  createItem(
    @Body() dto: CreateFooterItemDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.createItem(dto, user.userId, ip);
  }

  @Patch('items/reorder')
  @HttpCode(HttpStatus.OK)
  reorderItems(
    @Body() dto: ReorderFooterItemsDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.reorderItems(dto, user.userId, ip);
  }

  @Patch('items/:id')
  @HttpCode(HttpStatus.OK)
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateFooterItemDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.updateItem(id, dto, user.userId, ip);
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.footerService.deleteItem(id, user.userId, ip);
  }
}
