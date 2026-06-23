// Playwright-specific seed: creates the two e2e test users.
// Called once by apps/web/e2e/global-setup.ts before any Playwright test runs.
// Uses upsert so it is safe to run multiple times (idempotent).
//
// Users created:
//   seller-e2e@example.com  (emailVerified: true) — publishes the listing in the test
//   buyer-e2e@example.com   (emailVerified: true) — searches and contacts the seller
//
// Password for both: Test1234! (bcrypt cost 4, same convention as other test seeds)

import { PrismaClient } from '@prisma/client';
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

  console.log('Playwright seed: seller-e2e + buyer-e2e OK');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
