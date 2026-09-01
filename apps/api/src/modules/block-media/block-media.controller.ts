import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { BlockMediaService } from './block-media.service';
import { PresignBlockVideoDto } from './dto/presign-block-video.dto';
import { PresignBlockPosterDto } from './dto/presign-block-poster.dto';
import { ConfirmBlockMediaDto } from './dto/confirm-block-media.dto';

/**
 * VÍDEO DE BLOQUE V1 — subida de media pesada para el contenido editorial.
 *
 * AQUÍ NO HAY, NI PUEDE HABER, `FileInterceptor` NI `memoryStorage` (barrera B-1). Es la
 * diferencia entera con `POST /admin/blog/upload-image`, que sí sube por la API porque una
 * imagen de 10 MB en RAM es inocua. Un `.mp4` de 50 MB no lo es: diez editores subiendo a
 * la vez serían cientos de megas en el mismo proceso que atiende toda la API. El único
 * camino es firmar aquí y que el navegador haga el PUT directo contra R2.
 *
 * UN SOLO CONTROLADOR PARA LOS TRES CONTEXTOS (blog, páginas y portada), al revés que las
 * imágenes, que tienen un endpoint por superficie. Aquellos se separaron porque clonar seis
 * líneas es gratis y porque la portada era ADMIN y el blog EDITOR — pero **hoy los dos son
 * EDITOR**, así que ese motivo ya no existe, y aquí lo que se clonaría no son seis líneas
 * sino el presign, el confirm y su prefijo. Ver `docs/diseno-video-bloque.md` §3.1.
 *
 * EL GATE ES `EDITOR`, el mismo de `upload-image` (blog-admin.controller.ts) y el de toda
 * la portada (homepage-admin.controller.ts). Nada de Pro, ni de propiedad de anuncio, ni de
 * estado: eso es de anuncios.
 */
@ApiTags('Admin Media de bloque')
@ApiBearerAuth('access-token')
@Controller('admin/block-media')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.EDITOR)
export class BlockMediaController {
  constructor(private readonly blockMedia: BlockMediaService) {}

  @Post('video-url')
  videoUploadUrl(@CurrentUser() user: JwtUser, @Body() dto: PresignBlockVideoDto) {
    return this.blockMedia.createVideoUploadUrl(user.userId, dto);
  }

  @Post('poster-url')
  posterUploadUrl(@CurrentUser() user: JwtUser, @Body() dto: PresignBlockPosterDto) {
    return this.blockMedia.createPosterUploadUrl(user.userId, dto);
  }

  /**
   * Confirma que lo subido es lo autorizado. NO mueve el objeto: sigue en `tmp/` hasta que
   * alguien guarde el post o la portada. Ver `BlockMediaService.confirmUpload`.
   *
   * `200` y no `201`: no crea nada, comprueba.
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() user: JwtUser, @Body() dto: ConfirmBlockMediaDto) {
    return this.blockMedia.confirmUpload(user.userId, dto.key);
  }
}
