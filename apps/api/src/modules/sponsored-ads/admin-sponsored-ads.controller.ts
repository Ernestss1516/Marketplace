import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../media/media.service';
import { SponsoredAdsService } from './sponsored-ads.service';
import { CreateSponsoredAdDto } from './dto/create-sponsored-ad.dto';
import { UpdateSponsoredAdDto } from './dto/update-sponsored-ad.dto';
import { ListSponsoredAdsDto } from './dto/list-sponsored-ads.dto';

@ApiTags('Admin — Sponsored Ads')
@ApiBearerAuth('access-token')
@Controller('admin/sponsored-ads')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminSponsoredAdsController {
  constructor(private readonly sponsoredAdsService: SponsoredAdsService) {}

  @Get()
  list(@Query() query: ListSponsoredAdsDto) {
    return this.sponsoredAdsService.list(query);
  }

  @Post()
  create(@Body() dto: CreateSponsoredAdDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.sponsoredAdsService.create(dto, user.userId, ip);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSponsoredAdDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.sponsoredAdsService.update(id, dto, user.userId, ip);
  }

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
          cb(new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.'), false);
        }
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.sponsoredAdsService.uploadImage(file);
  }
}
