import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../media/media.service';
import { JwtUser } from '../auth/auth.types';
import { HomepageService } from './homepage.service';
import { UpdateHomepageDto } from './dto/update-homepage.dto';
import { IMAGEN_TIPO_NO_ADMITIDO, SIN_FICHERO } from '../../common/mensajes-subida';

/**
 * CRUD de la configuración de portada. Solo ADMIN, igual que footer y nav
 * (footer-admin.controller.ts:31, nav-admin.controller.ts:28): la portada es
 * CONFIGURACIÓN del sitio, no contenido. El blog es más laxo
 * (EDITOR/MODERATOR/ADMIN) precisamente porque sí es contenido.
 *
 * No hay POST ni DELETE: la config es una fila única que el servicio mantiene
 * por upsert. "Crear una portada" o "borrar la portada" no son operaciones.
 */
@ApiTags('Admin Portada')
@ApiBearerAuth('access-token')
@Controller('admin/homepage')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.EDITOR)
export class HomepageAdminController {
  constructor(private readonly homepageService: HomepageService) {}

  // Mismo payload que el endpoint público. Existe por simetría con el resto del
  // backoffice y para que el editor no dependa de una ruta pública que algún
  // día podría cachearse en un CDN por delante de Next.
  @Get()
  get() {
    return this.homepageService.get();
  }

  // Ruta estática ('upload-image'), declarada antes del PATCH por consistencia
  // con el resto del codebase. Aquí no hay riesgo de colisión: este controller
  // no tiene ninguna ruta con `:id`.
  @Post('upload-image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new UnprocessableEntityException(IMAGEN_TIPO_NO_ADMITIDO), false);
        }
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException(SIN_FICHERO);
    return this.homepageService.uploadImage(file);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  update(@Body() dto: UpdateHomepageDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.homepageService.update(dto, user.userId, ip);
  }
}
