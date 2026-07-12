import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Stripe checkout is Pro-subscription only (RECURRING prices). One-time
 * featured-listing purchases go exclusively through Redsys
 * (POST /billing/checkout/featured-pay) — see billing.service.ts
 * createCheckoutSession. No listingId here: the global ValidationPipe
 * (forbidNonWhitelisted) rejects it with a 400 if a client still sends one.
 */
export class CheckoutDto {
  @ApiProperty({ description: 'Our internal Price ID (cuid)' })
  @IsString()
  @MinLength(1)
  priceId!: string;
}
