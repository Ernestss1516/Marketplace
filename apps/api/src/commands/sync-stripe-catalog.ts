/**
 * sync-stripe-catalog — bootstrap command.
 *
 * Creates Stripe Products/Prices for every local Price that:
 *   - belongs to a RECURRING product (interval IS NOT NULL), and
 *   - has not been synced yet (gatewayPriceId IS NULL).
 *
 * Idempotent: a Price with gatewayPriceId already set is silently skipped.
 * Running the command twice in a row produces no duplicate Stripe objects.
 *
 * Usage (from apps/api/):
 *   pnpm sync-stripe-catalog
 *
 * Requires: STRIPE_SECRET_KEY in the environment (via .env).
 * Exits with code 1 and prints an error if the key is missing.
 */

import 'dotenv/config';
import { PrismaClient, PriceInterval } from '@prisma/client';
import Stripe = require('stripe');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Decimal amount (e.g. "9.99") to Stripe integer cents (999). */
export function toCents(amount: { toNumber(): number }): number {
  return Math.round(amount.toNumber() * 100);
}

/** Map our PriceInterval enum to the Stripe recurring interval string. */
export function toStripeInterval(interval: PriceInterval): 'month' | 'year' {
  return interval.toLowerCase() as 'month' | 'year';
}

/**
 * Resolve the Stripe Product ID for a given local productId.
 *
 * Priority:
 * 1. If a sibling Price already has gatewayPriceId set, retrieve it from
 *    Stripe to read the associated Stripe Product ID.
 * 2. Otherwise, list active Stripe Products and reuse the one matching by
 *    name; create it if none is found.
 */
async function resolveStripeProductId(
  stripe: Stripe,
  prisma: PrismaClient,
  productId: string,
  productName: string,
): Promise<string> {
  // Try to derive the Stripe Product from a sibling Price that is already synced.
  const synced = await prisma.price.findFirst({
    where: { productId, gatewayPriceId: { not: null } },
    select: { gatewayPriceId: true },
  });

  if (synced?.gatewayPriceId) {
    const stripePrice = await stripe.prices.retrieve(synced.gatewayPriceId);
    // stripePrice.product is either a string ID or an expanded Product object.
    const stripeProductId =
      typeof stripePrice.product === 'string'
        ? stripePrice.product
        : stripePrice.product.id;
    console.log(
      `  → Reusing Stripe Product ${stripeProductId} (derived from sibling price ${synced.gatewayPriceId})`,
    );
    return stripeProductId;
  }

  // No sibling found — look up existing products in Stripe by name.
  const list = await stripe.products.list({ active: true, limit: 100 });
  const match = list.data.find((p) => p.name === productName);
  if (match) {
    console.log(
      `  → Found existing Stripe Product "${productName}" (${match.id})`,
    );
    return match.id;
  }

  // Create a new Stripe Product.
  const created = await stripe.products.create({ name: productName });
  console.log(
    `  → Created new Stripe Product "${productName}" (${created.id})`,
  );
  return created.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error(
      'ERROR: STRIPE_SECRET_KEY is not set. Set it in .env before running this command.',
    );
    process.exit(1);
  }

  const stripe = new Stripe(stripeKey);
  const prisma = new PrismaClient();

  try {
    // Query all RECURRING prices not yet synced to Stripe.
    const pending = await prisma.price.findMany({
      where: {
        interval: { not: null },
        gatewayPriceId: null,
      },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) {
      console.log('All recurring prices are already synced. Nothing to do.');
      return;
    }

    console.log(`Found ${pending.length} price(s) to sync with Stripe.`);

    for (const price of pending) {
      console.log(
        `\nSyncing: "${price.product.name}" — ${price.interval} × ${price.intervalCount} — ${price.amount} EUR (id: ${price.id})`,
      );

      const stripeProductId = await resolveStripeProductId(
        stripe,
        prisma,
        price.productId,
        price.product.name,
      );

      const stripePrice = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: toCents(price.amount),
        currency: 'eur',
        recurring: {
          interval: toStripeInterval(price.interval!),
          interval_count: price.intervalCount ?? 1,
        },
      });

      await prisma.price.update({
        where: { id: price.id },
        data: { gatewayPriceId: stripePrice.id },
      });

      console.log(`  ✓ Created Stripe Price ${stripePrice.id} → saved to DB`);
    }

    console.log('\nSync complete.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('sync-stripe-catalog failed:', err);
    process.exit(1);
  });
}
