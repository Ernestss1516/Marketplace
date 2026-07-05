import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { BillingService } from './billing.service';
import { EntitlementService } from './entitlement.service';
import { CheckoutDto } from './dto/checkout.dto';
import { FeaturedByCreditsDto } from './dto/featured-by-credits.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';
import { WalletQueryDto } from './dto/wallet-query.dto';

@ApiTags('Billing')
@ApiBearerAuth('access-token')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public — no auth required
  // ---------------------------------------------------------------------------

  @Get('catalog')
  getCatalog() {
    return this.billing.getCatalog();
  }

  // ---------------------------------------------------------------------------
  // Authenticated endpoints
  // ---------------------------------------------------------------------------

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  createCheckout(@CurrentUser() user: JwtUser, @Body() dto: CheckoutDto) {
    return this.billing.createCheckoutSession(user.userId, dto);
  }

  @Post('cancel-subscription/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  cancelSubscription(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.billing.cancelSubscription(user.userId, id);
  }

  @Get('my-subscriptions')
  @UseGuards(JwtAuthGuard)
  getMySubscriptions(@CurrentUser() user: JwtUser) {
    return this.billing.getMySubscriptions(user.userId);
  }

  @Get('my-entitlements')
  @UseGuards(JwtAuthGuard)
  getMyEntitlements(@CurrentUser() user: JwtUser) {
    return this.billing.getMyEntitlements(user.userId);
  }

  @Get('my-transactions')
  @UseGuards(JwtAuthGuard)
  getMyTransactions(@CurrentUser() user: JwtUser, @Query() query: TransactionsQueryDto) {
    return this.billing.getMyTransactions(user.userId, query);
  }

  /**
   * H8.2 — punto único donde el frontend consulta la cuota mensual de
   * destacados gratis de Pro. Un no-Pro recibe { isPro: false, ... }.
   */
  @Get('pro-status')
  @UseGuards(JwtAuthGuard)
  getProStatus(@CurrentUser() user: JwtUser) {
    return this.entitlements.getFeaturedQuotaStatus(user.userId);
  }

  // ---------------------------------------------------------------------------
  // RF.6: Featured by credits
  // ---------------------------------------------------------------------------

  @Post('featured-by-credits')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  featuredByCredits(@CurrentUser() user: JwtUser, @Body() dto: FeaturedByCreditsDto) {
    return this.billing.featuredByCredits(user.userId, dto);
  }

  // ---------------------------------------------------------------------------
  // RF.6: Wallet
  // ---------------------------------------------------------------------------

  @Get('wallet')
  @UseGuards(JwtAuthGuard)
  getWallet(@CurrentUser() user: JwtUser, @Query() query: WalletQueryDto) {
    return this.billing.getWallet(user.userId, query);
  }
}
