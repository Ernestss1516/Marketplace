import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { RedsysService } from './redsys.service';
import { RedsysWebhookGuard, type RedsysWebhookRequest } from './guards/redsys-webhook.guard';
import { CheckoutCreditsPackDto } from './dto/checkout-credits-pack.dto';
import { CheckoutBumpPackDto } from './dto/checkout-bump-pack.dto';
import { CheckoutFeaturedPayDto } from './dto/checkout-featured-pay.dto';

/**
 * Redsys checkout endpoints (JWT-authenticated) and notification webhook
 * (HMAC-authenticated via RedsysWebhookGuard).
 *
 * ⚠️ INVARIANTE DE SEGURIDAD: URLOK (/planes/exito-redsys) NUNCA ejecuta
 * lógica de negocio. Todo ocurre exclusivamente en POST /webhooks/redsys.
 * Ver diseno-facturacion.md §7.5.
 */
@Controller()
export class RedsysController {
  constructor(private readonly redsysService: RedsysService) {}

  // ---------------------------------------------------------------------------
  // Authenticated checkout endpoints
  // ---------------------------------------------------------------------------

  @ApiTags('Billing')
  @ApiBearerAuth('access-token')
  @Post('billing/checkout/credits-pack')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  checkoutCreditsPack(
    @CurrentUser() user: JwtUser,
    @Body() dto: CheckoutCreditsPackDto,
  ) {
    return this.redsysService.createCreditPackCheckout(user.userId, dto);
  }

  @ApiTags('Billing')
  @ApiBearerAuth('access-token')
  @Post('billing/checkout/bump-pack')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  checkoutBumpPack(
    @CurrentUser() user: JwtUser,
    @Body() dto: CheckoutBumpPackDto,
  ) {
    return this.redsysService.createBumpPackCheckout(user.userId, dto);
  }

  @ApiTags('Billing')
  @ApiBearerAuth('access-token')
  @Post('billing/checkout/featured-pay')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  checkoutFeaturedPay(
    @CurrentUser() user: JwtUser,
    @Body() dto: CheckoutFeaturedPayDto,
  ) {
    return this.redsysService.createFeaturedPayCheckout(user.userId, dto);
  }

  // ---------------------------------------------------------------------------
  // Redsys notification webhook (no JWT — HMAC via RedsysWebhookGuard)
  // ---------------------------------------------------------------------------

  /**
   * Redsys notification online. Authentication is via HMAC signature
   * (RedsysWebhookGuard), NOT via JWT — this URL is called server-to-server
   * by Redsys and must be publicly reachable without a bearer token.
   *
   * The guard handles:
   *   1. HMAC signature verification (invalid → 400)
   *   2. GatewayEvent idempotency (duplicate → 200 immediately)
   *   3. Enqueuing REDSYS_SUCCESS job (or marking Transaction FAILED)
   *
   * This handler only needs to return 200.
   */
  @Post('webhooks/redsys')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RedsysWebhookGuard)
  @ApiExcludeEndpoint()
  handleRedsysWebhook(@Req() req: RedsysWebhookRequest) {
    if (req.isDuplicate) {
      return { received: true, duplicate: true };
    }
    return { received: true };
  }
}
