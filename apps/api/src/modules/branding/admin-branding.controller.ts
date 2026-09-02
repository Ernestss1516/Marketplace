import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
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
import { JwtUser } from '../auth/auth.types';
import { BrandingService } from './branding.service';
import {
  LOGO_ALLOWED_MIME_TYPES,
  LOGO_MAX_BYTES,
  LOGO_MIME_ERROR,
} from './branding.constants';

/**
 * TRES LOGOS L1 — la marca de la instancia, por zona.
 *
 * **ADMIN, no EDITOR**, y es el argumento ya escrito en `HomepageService.uploadImage`:
 * que el rol de subir coincida con el rol de poder usar lo subido. El blog admite
 * EDITOR porque es contenido; la identidad de la plataforma es configuración, y además
 * es lo que distingue una instancia de otra en el backoffice.
 *
 * UN ENDPOINT CON LA ZONA COMO DATO, no tres endpoints iguales: el cuerpo sería
 * idéntico y triplicarlo es exactamente cómo divergen. La zona se valida contra el enum
 * del módulo (`BrandingService.assertZone`) — no hay `:zone` libre.
 */
@ApiTags('Admin Marca')
@ApiBearerAuth('access-token')
@Controller('admin/branding')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminBrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  /**
   * Sube el logo de una zona. Devuelve las TRES URLs, no sólo la que cambia: quien
   * acaba de subir ve su cabecera actualizada sin una segunda petición, y el cuerpo de
   * la respuesta es el mismo del `GET` (una forma, no dos).
   *
   * `limits.fileSize` es el corte duro (413 de multer); el servicio lo vuelve a
   * comprobar porque el límite es una decisión del dominio y no de un decorador.
   */
  @Post('logos/:zone')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: LOGO_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        // El mapa PROPIO del módulo, que sí admite SVG. El compartido
        // (`ALLOWED_MIME_TYPES`) se queda intacto a propósito — ver branding.constants.
        if (LOGO_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new UnprocessableEntityException(LOGO_MIME_ERROR), false);
        }
      },
    }),
  )
  upload(
    @Param('zone') zone: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.brandingService.setLogo(zone, file, user.userId, ip);
  }

  /** Quita el logo de una zona: esa zona vuelve a su fallback. Idempotente. */
  @Delete('logos/:zone')
  @HttpCode(HttpStatus.OK)
  clear(@Param('zone') zone: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.brandingService.clearLogo(zone, user.userId, ip);
  }
}
