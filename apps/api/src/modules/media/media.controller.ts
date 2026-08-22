import {
  BadRequestException,
  Controller,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { MediaService, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from './media.service';

@ApiTags('Media')
@ApiBearerAuth('access-token')
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
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
          cb(new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.'), false);
        }
      },
    }),
  )
  upload(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.mediaService.upload(user.userId, file);
  }

  @Post('upload-avatar')
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
          cb(new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.'), false);
        }
      },
    }),
  )
  uploadAvatar(
    // HUÉRFANAS H2 — el usuario ya llegaba aquí y se ignoraba (`_user`). Ahora va a la
    // clave temporal (`avatars/tmp/<userId>/…`), que es lo que permite rechazar después la
    // subida de otro. Ver `MediaService.uploadAvatar`.
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.mediaService.uploadAvatar(user.userId, file);
  }
}
