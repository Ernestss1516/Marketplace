import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { ReorderTagsDto } from './dto/reorder-tags.dto';
import { ListTagsDto } from './dto/list-tags.dto';
import { SetCategoryTagsDto } from './dto/set-category-tags.dto';

/**
 * B1 — catálogo global de tags. ADMIN-only, igual que la configuración de categorías y
 * atributos: define el vocabulario de todo el sitio, no es moderación de contenido.
 */
@ApiTags('Admin — Tags')
@ApiBearerAuth('access-token')
@Controller('admin/tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo completo (activos e inactivos), paginado, con búsqueda por nombre' })
  list(@Query() query: ListTagsDto) {
    return this.tagsService.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un tag. El slug se deriva del nombre si no se indica.' })
  create(@Body() dto: CreateTagDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.tagsService.create(dto, user.userId, ip);
  }

  // Ruta ESTÁTICA antes que la de :id — mismo gotcha ya documentado en
  // AdminController (categories/reorder) y AdminContactReasonsController: si va después,
  // "reorder" se captura como un id.
  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  reorder(@Body() dto: ReorderTagsDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.tagsService.reorder(dto, user.userId, ip);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'A cuántos anuncios y categorías afecta — para avisar antes de desactivar' })
  usage(@Param('id') id: string) {
    return this.tagsService.usage(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renombra, reordena o desactiva. El slug es inmutable.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.tagsService.update(id, dto, user.userId, ip);
  }
}

/**
 * B1 — asignación de tags a una categoría.
 *
 * Endpoints propios y no un campo más en `PATCH /admin/categories/:id` porque el set de
 * tags es una relación N:M, no una propiedad escalar de la categoría — mismo criterio
 * por el que `reorder` y `attribute-usage` son rutas propias.
 */
@ApiTags('Admin — Tags de categoría')
@ApiBearerAuth('access-token')
@Controller('admin/categories/:id/tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCategoryTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'Tags propios (editables) y heredados del padre (solo lectura)' })
  get(@Param('id') id: string) {
    return this.tagsService.categoryTags(id);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reemplaza el set PROPIO. No toca los heredados: son del padre.' })
  set(
    @Param('id') id: string,
    @Body() dto: SetCategoryTagsDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.tagsService.setCategoryTags(id, dto, user.userId, ip);
  }
}
