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
import { AdminBillingService } from './admin-billing.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';
import { CreditGrantDto } from './dto/credit-grant.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateCreditPackDto } from './dto/update-credit-pack.dto';

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

  @Get('prices')
  listPrices() {
    return this.adminBillingService.listPrices();
  }

  @Patch('prices/:id')
  updatePrice(
    @Param('id') id: string,
    @Body() dto: UpdatePriceDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.updatePrice(id, user.userId, dto, ip);
  }

  @Patch('credit-packs/:id')
  updateCreditPackAmount(
    @Param('id') id: string,
    @Body() dto: UpdateCreditPackDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.updateCreditPackAmount(id, user.userId, dto, ip);
  }
}
