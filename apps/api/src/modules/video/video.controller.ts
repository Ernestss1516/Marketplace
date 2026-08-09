import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { VideoService } from './video.service';
import { PresignVideoDto } from './dto/presign-video.dto';
import { ConfirmVideoDto } from './dto/confirm-video.dto';

/**
 * Vídeo Pro — la API de infraestructura.
 *
 * NINGUNA de estas rutas recibe el fichero: el vídeo viaja del navegador al almacenamiento
 * por la URL prefirmada que `POST /video/upload-url` devuelve. Aquí solo se decide quién
 * puede subir, con qué límites, y qué se enlaza al anuncio.
 */
@ApiTags('Vídeo')
@ApiBearerAuth('access-token')
@Controller('video')
@UseGuards(JwtAuthGuard)
export class VideoController {
  constructor(private readonly video: VideoService) {}

  /** Los límites vigentes, para validar en el cliente ANTES de subir 50 MB para nada. */
  @Get('limits')
  limits() {
    return this.video.getLimits();
  }

  @Post('upload-url')
  createUploadUrl(@CurrentUser() user: JwtUser, @Body() dto: PresignVideoDto) {
    return this.video.createUploadUrl(user.userId, dto);
  }

  @Post('listings/:listingId/confirm')
  confirm(
    @CurrentUser() user: JwtUser,
    @Param('listingId') listingId: string,
    @Body() dto: ConfirmVideoDto,
  ) {
    return this.video.confirmUpload(user.userId, listingId, dto);
  }

  @Delete('listings/:listingId')
  remove(@CurrentUser() user: JwtUser, @Param('listingId') listingId: string) {
    return this.video.removeVideo(user.userId, listingId);
  }
}
