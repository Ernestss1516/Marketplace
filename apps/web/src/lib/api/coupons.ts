import { apiFetch } from './client';

export interface RedeemCouponResult {
  rewardType: 'CREDITS' | 'FEATURED';
  creditAmount: number | null;
  featuredDurationDays: number | null;
}

/**
 * H8 Bloque D fase 3 — canje de cupones. `listingId` solo hace falta si el
 * cupón otorga un destacado (rewardType=FEATURED) — si se omite y hace falta,
 * el backend responde 400 LISTING_REQUIRED (ver isListingRequiredError en client.ts).
 */
export function redeemCoupon(
  token: string,
  params: { code: string; listingId?: string },
): Promise<RedeemCouponResult> {
  return apiFetch<RedeemCouponResult>('/coupons/redeem', {
    method: 'POST',
    body: JSON.stringify(params),
    token,
  });
}
