import {
  Body,
  Controller,
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
import { ModerationService } from './moderation.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationActionDto } from './dto/moderation-action.dto';

@ApiTags('Moderation')
@ApiBearerAuth('access-token')
@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MODERATOR, Role.ADMIN)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // ─── Reports ──────────────────────────────────────────────────────────────

  // Any authenticated user can file a report — override class-level roles.
  @Post('reports')
  @Roles(Role.USER, Role.MODERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createReport(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateReportDto,
  ) {
    return this.moderationService.createReport(user.userId, dto);
  }

  @Get('reports')
  listReports(@Query() query: ListReportsQueryDto) {
    return this.moderationService.listReports(query);
  }

  @Get('reports/:id')
  getReport(@Param('id') id: string) {
    return this.moderationService.getReport(id);
  }

  @Patch('reports/:id/start-review')
  @HttpCode(HttpStatus.OK)
  startReview(@Param('id') id: string) {
    return this.moderationService.startReview(id);
  }

  @Patch('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveReport(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.moderationService.resolveReport(id, user.userId, ip);
  }

  @Patch('reports/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismissReport(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.moderationService.dismissReport(id, user.userId, ip);
  }

  // ─── Listing moderation actions ────────────────────────────────────────────

  @Post('listings/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveListing(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.moderationService.approveListing(id, user.userId, ip);
  }

  @Post('listings/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectListing(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Body() dto: ModerationActionDto,
  ) {
    return this.moderationService.rejectListing(id, user.userId, dto.reason, ip);
  }

  @Post('listings/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivateListing(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Body() dto: ModerationActionDto,
  ) {
    return this.moderationService.deactivateListing(id, user.userId, dto.reason, ip);
  }

  @Post('listings/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreListing(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.moderationService.restoreListing(id, user.userId, ip);
  }
}
