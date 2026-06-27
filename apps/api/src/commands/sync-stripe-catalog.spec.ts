import { PriceInterval } from '@prisma/client';
import { toCents, toStripeInterval } from './sync-stripe-catalog';

describe('toCents', () => {
  it('converts 9.99 to 999', () => {
    expect(toCents({ toNumber: () => 9.99 })).toBe(999);
  });

  it('converts 89.99 to 8999', () => {
    expect(toCents({ toNumber: () => 89.99 })).toBe(8999);
  });

  it('rounds half-cent amounts correctly', () => {
    // 0.005 → rounds to 1 cent (Math.round)
    expect(toCents({ toNumber: () => 0.005 })).toBe(1);
  });

  it('handles integer amounts', () => {
    expect(toCents({ toNumber: () => 10 })).toBe(1000);
  });
});

describe('toStripeInterval', () => {
  it('maps MONTH to month', () => {
    expect(toStripeInterval(PriceInterval.MONTH)).toBe('month');
  });

  it('maps YEAR to year', () => {
    expect(toStripeInterval(PriceInterval.YEAR)).toBe('year');
  });

});
