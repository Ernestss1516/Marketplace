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
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { NavService } from './nav.service';
import { CreateNavItemDto } from './dto/create-nav-item.dto';
import { UpdateNavItemDto } from './dto/update-nav-item.dto';
import { ReorderNavItemsDto } from './dto/reorder-nav-items.dto';

@ApiTags('Admin Nav')
@ApiBearerAuth('access-token')
@Controller('admin/nav')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class NavAdminController {
  constructor(private readonly navService: NavService) {}

  /**
   * Estructura completa SIN podar: incluye nodos inactivos, con la página en
   * borrador o temporalmente inválidos (sin destino y sin hijos). El admin
   * necesita verlos para arreglarlos — mismo criterio que GET /admin/footer.
   */
  @Get()
  getStructure() {
    return this.navService.adminListStructure();
  }

  // ─── Items ──────────────────────────────────────────────────────────────
  // IMPORTANTE: la ruta estática items/reorder debe declararse ANTES de
  // items/:id, o Nest captura "reorder" como un :id. Mismo gotcha ya
  // documentado en FooterAdminController (items/reorder) y en AdminController
  // (categories/reorder).

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  createItem(
    @Body() dto: CreateNavItemDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.navService.createItem(dto, user.userId, ip);
  }

  @Patch('items/reorder')
  @HttpCode(HttpStatus.OK)
  reorderItems(
    @Body() dto: ReorderNavItemsDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.navService.reorderItems(dto, user.userId, ip);
  }

  @Patch('items/:id')
  @HttpCode(HttpStatus.OK)
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateNavItemDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.navService.updateItem(id, dto, user.userId, ip);
  }

  /** Se lleva el subárbol por cascade — la UI anuncia cuántos antes de confirmar. */
  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.navService.deleteItem(id, user.userId, ip);
  }
}
