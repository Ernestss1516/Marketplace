import {
  BadRequestException,
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
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { BlogService } from './blog.service';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../media/media.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListAdminPostsDto } from './dto/list-admin-posts.dto';

@ApiTags('Admin Blog')
@ApiBearerAuth('access-token')
@Controller('admin/blog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BlogAdminController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  findAll(@Query() dto: ListAdminPostsDto) {
    return this.blogService.adminFindAll(dto);
  }

  @Get(':id')
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  findById(@Param('id') id: string) {
    return this.blogService.adminFindById(id);
  }

  @Post()
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminCreate(user.userId, dto, ip);
  }

  // Upload de imagen para el bloque `image` (Ráfaga 2 del editor) — molde
  // SponsoredAdsService.uploadImage: sube directo a R2, NO crea ListingImage.
  // Ruta estática ('upload-image', sin más segmentos) — no colisiona con
  // ningún `:id` de este controller (no hay un `POST :id` a secas), pero se
  // declara junto al resto de rutas sin `:id` por consistencia con el resto
  // del codebase.
  @Post('upload-image')
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
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
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.blogService.uploadBlockImage(file);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminUpdate(id, user.userId, dto, ip);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  publish(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminPublish(id, user.userId, ip);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)
  unpublish(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminUnpublish(id, user.userId, ip);
  }

  // Permanent deletion — ADMIN-only (inherits class-level @Roles(ADMIN)).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminDelete(id, user.userId, ip);
  }
}
