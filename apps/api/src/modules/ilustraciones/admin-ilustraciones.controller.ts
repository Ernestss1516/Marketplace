import {
  BadRequestException,
  Controller,
  Delete,
  Get,
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
import { IlustracionesService } from './ilustraciones.service';
import { SIN_FICHERO } from '../../common/mensajes-subida';
import {
  ILUSTRACION_ALLOWED_MIME_TYPES,
  ILUSTRACION_MAX_BYTES,
  ILUSTRACION_MIME_ERROR,
} from './ilustraciones.constants';

/**
 * E7 — sustituir las ilustraciones de la instancia.
 *
 * **ADMIN, no EDITOR**, y es el mismo argumento que en la marca y en la portada: que el
 * rol de subir coincida con el de poder usar lo subido. El blog admite EDITOR porque es
 * contenido; una ilustración de estado vacío es configuración del aspecto de la
 * plataforma, y quien la cambia está cambiando lo que ve todo el mundo.
 *
 * UN ENDPOINT CON EL SLOT COMO DATO, no diez endpoints iguales: el cuerpo sería idéntico y
 * multiplicarlo por diez es exactamente cómo divergen. El slot se valida contra el
 * registro (`IlustracionesService.assertSlot`) — no hay `:slot` libre.
 */
@ApiTags('Admin Ilustraciones')
@ApiBearerAuth('access-token')
@Controller('admin/ilustraciones')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminIlustracionesController {
  constructor(private readonly ilustracionesService: IlustracionesService) {}

  /**
   * El catálogo (qué slots hay, con su descripción y proporción) MÁS lo que sirve hoy cada
   * uno. La pantalla necesita las dos cosas y en una sola petición: sin el catálogo no
   * puede explicar qué se está cambiando, y sin lo resuelto no puede previsualizar.
   */
  @Get()
  async get() {
    const [catalogo, resueltas] = await Promise.all([
      Promise.resolve(this.ilustracionesService.catalogo()),
      this.ilustracionesService.get(),
    ]);
    return { catalogo, resueltas };
  }

  /**
   * Sustituye la ilustración de un slot. Devuelve las DIEZ resueltas, no sólo la que
   * cambia: quien acaba de subir ve la pantalla actualizada sin una segunda petición, y el
   * cuerpo es el mismo del `GET` público (una forma, no dos).
   *
   * `limits.fileSize` es el corte duro (413 de multer); el servicio lo vuelve a comprobar
   * porque el límite es una decisión del dominio y no de un decorador.
   */
  @Post(':slot')
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
      limits: { fileSize: ILUSTRACION_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ILUSTRACION_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new UnprocessableEntityException(ILUSTRACION_MIME_ERROR), false);
        }
      },
    }),
  )
  upload(
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    if (!file) throw new BadRequestException(SIN_FICHERO);
    return this.ilustracionesService.setIlustracion(slot, file, user.userId, ip);
  }

  /** Quita la sustitución: el slot vuelve al default del modelo. Idempotente. */
  @Delete(':slot')
  @HttpCode(HttpStatus.OK)
  clear(@Param('slot') slot: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.ilustracionesService.clearIlustracion(slot, user.userId, ip);
  }
}
