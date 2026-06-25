import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import Stripe = require('stripe');
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';

interface WebhookRequest {
  stripeEvent?: Stripe.Event;
  isDuplicate?: boolean;
}

@Controller('webhooks')
export class WebhooksController {
  /**
   * Stripe webhook receiver. Authentication is via HMAC signature (StripeWebhookGuard),
   * NOT via JWT. The guard also handles idempotency (GatewayEvent) and enqueuing.
   * This controller only needs to return 200.
   */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(StripeWebhookGuard)
  @ApiExcludeEndpoint()
  handleStripeWebhook(@Req() req: WebhookRequest) {
    if (req.isDuplicate) {
      return { received: true, duplicate: true };
    }
    return { received: true };
  }
}
