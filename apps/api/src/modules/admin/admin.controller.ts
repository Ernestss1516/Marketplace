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
import { AdminService } from './admin.service';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Stats dashboard ──────────────────────────────────────────────────────

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  // ─── Listings ─────────────────────────────────────────────────────────────

  @Get('listings')
  @Roles(Role.MODERATOR, Role.ADMIN)
  listListings(@Query() query: ListAdminListingsDto) {
    return this.adminService.listListings(query);
  }

  @Get('listings/:id')
  @Roles(Role.MODERATOR, Role.ADMIN)
  getListingById(@Param('id') id: string) {
    return this.adminService.getListingById(id);
  }

  @Patch('listings/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.MODERATOR, Role.ADMIN)
  changeListingStatus(
    @Param('id') id: string,
    @Body() dto: ChangeListingStatusDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.changeListingStatus(id, user.userId, dto, ip);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  @Get('users')
  @Roles(Role.MODERATOR, Role.ADMIN)
  listUsers(@Query() query: ListAdminUsersDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  @Roles(Role.MODERATOR, Role.ADMIN)
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.MODERATOR, Role.ADMIN)
  suspendUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.suspendUser(id, user.userId, ip);
  }

  // Reverses a SUSPENSION (SUSPENDED → ACTIVE). MODERATOR+ADMIN.
  // Does not apply to BANNED users — use reinstateUser (ADMIN-only) for that.
  @Patch('users/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.MODERATOR, Role.ADMIN)
  unsuspendUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.unsuspendUser(id, user.userId, ip);
  }

  // Permanent ban — ADMIN-only (inherits class-level @Roles(ADMIN)).
  @Patch('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  banUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.banUser(id, user.userId, ip);
  }

  // Reverses a BAN (BANNED → ACTIVE) — ADMIN-only (inherits class-level @Roles(ADMIN)).
  @Patch('users/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.reinstateUser(id, user.userId, ip);
  }

  // Role change — ADMIN-only (inherits class-level @Roles(ADMIN)). INNEGOCIABLE.
  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  changeUserRole(
    @Param('id') id: string,
    @Body() dto: ChangeUserRoleDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.changeUserRole(id, user.userId, dto, ip);
  }

  // ─── Categories ───────────────────────────────────────────────────────────
  // IMPORTANT: static routes (@Get('categories/searchable-keys'),
  // @Patch('categories/reorder')) must be declared BEFORE param routes
  // (@Patch('categories/:id')) so the literal segment is not captured as :id.

  @Get('categories/searchable-keys')
  getSearchableAttributeKeys() {
    return this.adminService.getSearchableAttributeKeys();
  }

  @Get('categories')
  getCategories() {
    return this.adminService.getCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.createCategory(user.userId, dto, ip);
  }

  @Patch('categories/reorder')
  @HttpCode(HttpStatus.OK)
  reorderCategories(
    @Body() dto: ReorderCategoriesDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.reorderCategories(user.userId, dto, ip);
  }

  @Patch('categories/:id')
  @HttpCode(HttpStatus.OK)
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.updateCategory(id, user.userId, dto, ip);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.deleteCategory(id, user.userId, ip);
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings/:key')
  @HttpCode(HttpStatus.OK)
  updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.updateSetting(key, user.userId, dto, ip);
  }
}
