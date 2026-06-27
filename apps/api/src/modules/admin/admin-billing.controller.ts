import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AdminBillingService } from './admin-billing.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';
import { CreditGrantDto } from './dto/credit-grant.dto';

@ApiTags('Admin — Billing')
@ApiBearerAuth('access-token')
@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminBillingController {
  constructor(private readonly adminBillingService: AdminBillingService) {}

  @Get('transactions')
  listTransactions(@Query() query: ListAdminTransactionsDto) {
    return this.adminBillingService.listTransactions(query);
  }

  @Get('wallets')
  listWallets(@Query() query: ListAdminWalletsDto) {
    return this.adminBillingService.listWallets(query);
  }

  @Get('users/:userId')
  getUserBillingDetail(@Param('userId') userId: string) {
    return this.adminBillingService.getUserBillingDetail(userId);
  }

  @Post('users/:userId/credits')
  @HttpCode(HttpStatus.OK)
  grantCredits(
    @Param('userId') userId: string,
    @Body() dto: CreditGrantDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.grantCredits(userId, user.userId, dto, ip);
  }
}
