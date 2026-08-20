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
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AdminBillingService } from './admin-billing.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';
import { CreditGrantDto } from './dto/credit-grant.dto';
// FICHA DE USUARIO — U2.
import { GrantProDto } from './dto/grant-pro.dto';
import { RevokeProDto } from './dto/revoke-pro.dto';
import { BumpGrantDto } from './dto/bump-grant.dto';
import { BalanceDebitDto } from './dto/balance-debit.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateCreditPackDto } from './dto/update-credit-pack.dto';
import { UpdateBumpPackDto } from './dto/update-bump-pack.dto';

@ApiTags('Admin — Billing')
@ApiBearerAuth('access-token')
@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
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

  // ─── Ficha de usuario U2: las acciones de staff ────────────────────────────
  //
  // TODAS son ADMIN por el `@MinRole(Role.ADMIN)` de la CLASE, no por una
  // anotación propia: dar Pro, dar saldo y quitarlo son la misma clase de acción
  // que `grantCredits` —regalar o retirar algo que vale dinero— y viven donde ya
  // vivía esa. Un MODERATOR modera; esto no es moderar.

  @Post('users/:userId/pro')
  @HttpCode(HttpStatus.OK)
  grantPro(
    @Param('userId') userId: string,
    @Body() dto: GrantProDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.grantPro(userId, user.userId, dto, ip);
  }

  @Post('users/:userId/pro/revoke')
  @HttpCode(HttpStatus.OK)
  revokePro(
    @Param('userId') userId: string,
    @Body() dto: RevokeProDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.revokePro(userId, user.userId, dto, ip);
  }

  @Post('users/:userId/bumps')
  @HttpCode(HttpStatus.OK)
  grantBumps(
    @Param('userId') userId: string,
    @Body() dto: BumpGrantDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.grantBumps(userId, user.userId, dto, ip);
  }

  /**
   * Quitar saldo. Rutas SEPARADAS por moneda, hermanas de las de dar: créditos y
   * bumps son saldos distintos y mezclarlos en un endpoint con un parámetro
   * «moneda» invitaría a equivocarse justo en la operación que resta.
   */
  @Post('users/:userId/credits/debit')
  @HttpCode(HttpStatus.OK)
  debitCredits(
    @Param('userId') userId: string,
    @Body() dto: BalanceDebitDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.debitBalance(userId, user.userId, dto, 'CREDITS', ip);
  }

  @Post('users/:userId/bumps/debit')
  @HttpCode(HttpStatus.OK)
  debitBumps(
    @Param('userId') userId: string,
    @Body() dto: BalanceDebitDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.debitBalance(userId, user.userId, dto, 'BUMPS', ip);
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

  @Patch('bump-packs/:id')
  updateBumpPackAmount(
    @Param('id') id: string,
    @Body() dto: UpdateBumpPackDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminBillingService.updateBumpPackAmount(id, user.userId, dto, ip);
  }
}
