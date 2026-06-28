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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { BlogService } from './blog.service';
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
  @Roles(Role.MODERATOR, Role.ADMIN)
  findAll(@Query() dto: ListAdminPostsDto) {
    return this.blogService.adminFindAll(dto);
  }

  @Get(':id')
  @Roles(Role.MODERATOR, Role.ADMIN)
  findById(@Param('id') id: string) {
    return this.blogService.adminFindById(id);
  }

  @Post()
  @Roles(Role.MODERATOR, Role.ADMIN)
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminCreate(user.userId, dto, ip);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.MODERATOR, Role.ADMIN)
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
  @Roles(Role.MODERATOR, Role.ADMIN)
  publish(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.blogService.adminPublish(id, user.userId, ip);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.MODERATOR, Role.ADMIN)
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
