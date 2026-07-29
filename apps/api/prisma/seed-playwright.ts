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
//   editor-e2e@example.com      (role: EDITOR)         — backoffice editor E2E tests
//   role-target-e2e@example.com (role: USER, reset each seed) — target for role-assignment UI test
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
    // Reset location/phone so prefill tests always start from a known-empty state.
    update: { passwordHash, emailVerified: true, city: null, province: null, postalCode: null, phone: null },
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
        // condition es obligatorio para PRODUCT en EditarWizard.validateStep('datos') —
        // sin él, el wizard de edición nunca puede avanzar más allá de "Datos" (bug de
        // fixture hallado en H8 Bloque C2: el test de prefill-ubicacion.spec.ts que edita
        // este listing quedaba bloqueado ahí, sin llegar nunca a "Ubicación").
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: sellerUser.id,
        categoryId: category.id,
        publishedAt: new Date(),
        city: 'Madrid',
        province: 'Madrid',
      },
      update: { status: 'ACTIVE', city: 'Madrid', province: 'Madrid', condition: 'GOOD' },
    });
    console.log('Playwright seed: listing-rf11-e2e OK');

    // Reset accumulated active listings (except RF.11) to EXPIRED so they do not
    // count against the free-tier active-listing limit during the current test run.
    // Without this, each CI run adds listings and eventually hits the limit of 5,
    // causing ForbiddenException in publishListing → wizard shows submitError → no redirect.
    const { count: deactivated } = await prisma.listing.updateMany({
      where: { sellerId: sellerUser.id, slug: { not: 'listing-rf11-e2e' }, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    if (deactivated > 0) {
      console.log(`Playwright seed: reset ${deactivated} accumulated active listings to EXPIRED`);
    }
  }

  // ── ACTIVE listing for pro-e2e (needed by H8.5b spec: destacar por cuota) ────
  if (category) {
    await prisma.listing.upsert({
      where: { slug: 'listing-pro-e2e' },
      create: {
        title: 'Anuncio Pro E2E',
        slug: 'listing-pro-e2e',
        description: 'Anuncio del usuario Pro para pruebas de destacado por cuota.',
        price: 75,
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: proUser.id,
        categoryId: category.id,
        publishedAt: new Date(),
        city: 'Madrid',
        province: 'Madrid',
      },
      update: { status: 'ACTIVE', city: 'Madrid', province: 'Madrid' },
    });
    console.log('Playwright seed: listing-pro-e2e OK');
  }

  // ── Raise free-tier listing limit for E2E tests ─────────────────────────────
  // The default limit (5) is hit within a single CI run: RF.11 seed (1) +
  // categoria-meili (3) + flujo-critico (1) = 5 → wizard-herencia throws
  // ForbiddenException in publishListing → no redirect → waitForURL times out.
  // In tests we don't test the limit feature itself, so set it high enough to
  // never be a concern.
  await prisma.setting.upsert({
    where: { key: 'freeActiveListingLimit' },
    create: { key: 'freeActiveListingLimit', value: 100 },
    update: { value: 100 },
  });

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

  await prisma.user.upsert({
    where: { email: 'editor-e2e@example.com' },
    create: {
      email: 'editor-e2e@example.com',
      passwordHash,
      name: 'Editor E2E',
      slug: 'editor-e2e',
      emailVerified: true,
      role: 'EDITOR',
    },
    update: { passwordHash, emailVerified: true, role: 'EDITOR' },
  });

  // Target user for the /admin/usuarios role-assignment Playwright test — role is
  // always reset to USER on seed so the repeated-role-change test is idempotent
  // regardless of what a previous run left it as.
  await prisma.user.upsert({
    where: { email: 'role-target-e2e@example.com' },
    create: {
      email: 'role-target-e2e@example.com',
      passwordHash,
      name: 'Role Target E2E',
      slug: 'role-target-e2e',
      emailVerified: true,
      role: 'USER',
    },
    update: { passwordHash, emailVerified: true, role: 'USER' },
  });

  console.log('Playwright seed: admin-e2e + moderator-e2e + editor-e2e + role-target-e2e OK');

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

  // ── Movimiento facturable + datos fiscales para seller-e2e ────────────────
  // Atención al usuario R7 — `tickets-admin.spec.ts` necesita un ticket con una
  // FACTURA enlazada para ejercer en el navegador la puerta ADMIN-only (el
  // MODERATOR no lo ve ni lo abre). Emitir una factura exige dos cosas que el
  // seed no tenía: datos fiscales del usuario y al menos una Transaction
  // SUCCEEDED sin facturar. Se siembran aquí, de forma IDEMPOTENTE.
  //
  // Ningún otro spec depende del estado fiscal de seller-e2e (comprobado), y las
  // suites e2e de backend truncan User CASCADE en su propio cleanDb, así que
  // este dato no las alcanza.
  if (sellerUser) {
    await prisma.user.update({
      where: { id: sellerUser.id },
      data: {
        fiscalTaxId: '12345678Z',
        fiscalName: 'Vendedor E2E',
        fiscalEntityType: 'INDIVIDUAL',
        fiscalAddress: 'C/ Prueba 1',
        fiscalCity: 'Madrid',
        fiscalPostalCode: '28001',
        fiscalProvince: 'Madrid',
        fiscalCountry: 'ES',
      },
    });

    const anyPrice = await prisma.price.findFirst({ select: { id: true } });
    if (anyPrice) {
      // OJO — la condición es "¿queda algo FACTURABLE?", no "¿hay alguna
      // Transaction?". `tickets-admin.spec.ts` EMITE una factura en cada corrida,
      // y al emitirla la Transaction queda enlazada a una InvoiceLine y deja de
      // ser facturable. Con el guard ingenuo (`status: 'SUCCEEDED'` a secas) la
      // segunda corrida no sembraba nada y la emisión fallaba con 409
      // NO_INVOICEABLE_MOVEMENTS — el clásico "verde la primera vez, rojo al
      // repetir sin resetear la BD" (mismo principio que el reset de `phone` en
      // el seed para prefill-telefono.spec.ts).
      const yaHay = await prisma.transaction.findFirst({
        where: { userId: sellerUser.id, status: 'SUCCEEDED', invoiceLine: { is: null } },
        select: { id: true },
      });
      if (!yaHay) {
        await prisma.transaction.create({
          data: {
            userId: sellerUser.id,
            priceId: anyPrice.id,
            amountGross: 12.1,
            amountNet: 10,
            taxAmount: 2.1,
            taxRate: 0.21,
            status: 'SUCCEEDED',
            gateway: 'REDSYS',
          },
        });
      }
      console.log('Playwright seed: seller-e2e fiscal data + billable transaction OK');
    }
  }

  console.log('Playwright seed: seller-e2e + buyer-e2e + pro-e2e OK');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
