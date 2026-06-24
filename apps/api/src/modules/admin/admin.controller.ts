import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
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

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Listings ─────────────────────────────────────────────────────────────

  @Get('listings')
  listListings(@Query() query: ListAdminListingsDto) {
    return this.adminService.listListings(query);
  }

  @Get('listings/:id')
  getListingById(@Param('id') id: string) {
    return this.adminService.getListingById(id);
  }

  @Patch('listings/:id/status')
  @HttpCode(HttpStatus.OK)
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
  listUsers(@Query() query: ListAdminUsersDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspendUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.suspendUser(id, user.userId, ip);
  }

  @Patch('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  banUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.banUser(id, user.userId, ip);
  }

  @Patch('users/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.reinstateUser(id, user.userId, ip);
  }

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
}
