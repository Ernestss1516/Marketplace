// Playwright-specific seed: creates the e2e test users.
// Called once by apps/web/e2e/global-setup.ts before any Playwright test runs.
// Uses upsert so it is safe to run multiple times (idempotent).
//
// Users created:
//   seller-e2e@example.com      (emailVerified: true) — publishes the listing in the test
//   buyer-e2e@example.com       (emailVerified: true) — searches and contacts the seller
//   pro-e2e@example.com         (emailVerified: true) — has an active PRO_SUBSCRIPTION
//   admin-e2e@example.com       (role: ADMIN)          — backoffice admin E2E tests
//   moderator-e2e@example.com   (role: MODERATOR)      — backoffice moderator E2E tests
//
// Password for all: Test1234! (bcrypt cost 4)

import {
  PrismaClient,
  ProductType,
  SubscriptionStatus,
  EntitlementType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Test1234!', 4);

  await prisma.user.upsert({
    where: { email: 'seller-e2e@example.com' },
    create: {
      email: 'seller-e2e@example.com',
      passwordHash,
      name: 'Vendedor E2E',
      slug: 'vendedor-e2e',
      emailVerified: true,
    },
    update: { passwordHash, emailVerified: true },
  });

  await prisma.user.upsert({
    where: { email: 'buyer-e2e@example.com' },
    create: {
      email: 'buyer-e2e@example.com',
      passwordHash,
      name: 'Comprador E2E',
      slug: 'comprador-e2e',
      emailVerified: true,
    },
    update: { passwordHash, emailVerified: true },
  });

  // Pro user: needs a Subscription + PRO_SUBSCRIPTION Entitlement
  const proUser = await prisma.user.upsert({
    where: { email: 'pro-e2e@example.com' },
    create: {
      email: 'pro-e2e@example.com',
      passwordHash,
      name: 'Usuario Pro E2E',
      slug: 'usuario-pro-e2e',
      emailVerified: true,
    },
    update: { passwordHash, emailVerified: true },
  });

  // Look up the RECURRING monthly price seeded by seed-test.ts
  const proPrice = await prisma.price.findFirst({
    where: {
      active: true,
      interval: 'MONTH',
      product: { type: ProductType.RECURRING, active: true },
    },
    select: { id: true },
  });

  if (proPrice) {
    // Check if there's already a subscription for this user to stay idempotent
    const existingSub = await prisma.subscription.findFirst({
      where: { userId: proUser.id, status: SubscriptionStatus.ACTIVE },
      select: { id: true },
    });

    if (!existingSub) {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);

      const subscription = await prisma.subscription.create({
        data: {
          userId: proUser.id,
          priceId: proPrice.id,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          gatewaySubscriptionId: 'sub_test_pro_e2e_playwright',
        },
      });

      await prisma.entitlement.create({
        data: {
          userId: proUser.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          subscriptionId: subscription.id,
          startsAt: now,
          // expiresAt null = valid until the cron revokes it
        },
      });
    }

    console.log('Playwright seed: pro-e2e subscription + entitlement OK');
  } else {
    console.warn(
      'Playwright seed: no RECURRING price found — run seed-test.ts first (seedProPlans)',
    );
  }

  // ── ACTIVE listing for seller-e2e (needed by RF.11 spec) ──────────────────
  const sellerUser = await prisma.user.findUnique({
    where: { email: 'seller-e2e@example.com' },
    select: { id: true },
  });
  const category = await prisma.category.findFirst({ select: { id: true } });

  if (sellerUser && category) {
    await prisma.listing.upsert({
      where: { slug: 'listing-rf11-e2e' },
      create: {
        title: 'Anuncio RF.11 E2E',
        slug: 'listing-rf11-e2e',
        description: 'Anuncio para pruebas de destacado y bump.',
        price: 50,
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: sellerUser.id,
        categoryId: category.id,
        publishedAt: new Date(),
      },
      update: { status: 'ACTIVE' },
    });
    console.log('Playwright seed: listing-rf11-e2e OK');
  }

  // ── Admin and moderator users for role-separation E2E tests ──────────────────
  await prisma.user.upsert({
    where: { email: 'admin-e2e@example.com' },
    create: {
      email: 'admin-e2e@example.com',
      passwordHash,
      name: 'Admin E2E',
      slug: 'admin-e2e',
      emailVerified: true,
      role: 'ADMIN',
    },
    update: { passwordHash, emailVerified: true, role: 'ADMIN' },
  });

  await prisma.user.upsert({
    where: { email: 'moderator-e2e@example.com' },
    create: {
      email: 'moderator-e2e@example.com',
      passwordHash,
      name: 'Moderador E2E',
      slug: 'moderador-e2e',
      emailVerified: true,
      role: 'MODERATOR',
    },
    update: { passwordHash, emailVerified: true, role: 'MODERATOR' },
  });

  console.log('Playwright seed: admin-e2e + moderator-e2e OK');

  // ── Test report for moderator E2E tests ───────────────────────────────────────
  // The report is always reset to PENDING so the moderator action test is repeatable.
  const buyerUser = await prisma.user.findUnique({
    where: { email: 'buyer-e2e@example.com' },
    select: { id: true },
  });
  const testListing = await prisma.listing.findUnique({
    where: { slug: 'listing-rf11-e2e' },
    select: { id: true },
  });

  if (buyerUser && testListing) {
    await prisma.report.deleteMany({
      where: { reporterId: buyerUser.id, listingId: testListing.id, reason: 'SPAM' },
    });
    await prisma.report.create({
      data: {
        reporterId: buyerUser.id,
        listingId: testListing.id,
        reason: 'SPAM',
        description: 'Reporte de prueba para tests Playwright de moderación',
        status: 'PENDING',
      },
    });
    console.log('Playwright seed: test SPAM report OK');
  }

  console.log('Playwright seed: seller-e2e + buyer-e2e + pro-e2e OK');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
