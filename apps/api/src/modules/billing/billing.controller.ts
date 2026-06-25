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
import { CheckoutDto } from './dto/checkout.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';

@ApiTags('Billing')
@ApiBearerAuth('access-token')
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  createCheckout(@CurrentUser() user: JwtUser, @Body() dto: CheckoutDto) {
    return this.billing.createCheckoutSession(user.userId, dto);
  }

  @Post('cancel-subscription/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelSubscription(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.billing.cancelSubscription(user.userId, id);
  }

  @Get('my-subscriptions')
  getMySubscriptions(@CurrentUser() user: JwtUser) {
    return this.billing.getMySubscriptions(user.userId);
  }

  @Get('my-entitlements')
  getMyEntitlements(@CurrentUser() user: JwtUser) {
    return this.billing.getMyEntitlements(user.userId);
  }

  @Get('my-transactions')
  getMyTransactions(@CurrentUser() user: JwtUser, @Query() query: TransactionsQueryDto) {
    return this.billing.getMyTransactions(user.userId, query);
  }
}
