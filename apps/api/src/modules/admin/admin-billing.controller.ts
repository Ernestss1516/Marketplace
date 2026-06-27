import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators';
import { AdminBillingService } from './admin-billing.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';

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
}
