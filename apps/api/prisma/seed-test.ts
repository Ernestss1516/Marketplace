// Minimal static seed for the test database.
// Called once from globalSetup (test/setup-e2e.js) via ts-node.
// Uses upsert / skipDuplicates so it is safe to run multiple times.
// Does NOT create users or listings — those are created per-suite in beforeAll.
//
// Tables seeded here are EXCLUDED from cleanDb (Category, Setting, CreditPack,
// Price, Product) to avoid race conditions when Jest workers run suites in parallel.

import { PrismaClient, Prisma, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

async function seedCategories() {
  const electronica = await prisma.category.upsert({
    where: { slug: 'electronica' },
    create: {
      name: 'Electrónica',
      slug: 'electronica',
      order: 1,
      attributeSchema: [],
    },
    update: {},
  });

  await prisma.category.upsert({
    where: { slug: 'moviles' },
    create: {
      name: 'Móviles',
      slug: 'moviles',
      order: 1,
      parentId: electronica.id,
      attributeSchema: [
        { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
        { name: 'ram', label: 'RAM', type: 'number', unit: 'GB', filterable: true, required: false },
      ],
    },
    update: {},
  });

  console.log('Test seed: categories OK (electronica → moviles)');
}

async function seedSettings() {
  await prisma.setting.createMany({
    data: [
      { key: 'badWordList', value: [] },
      { key: 'listingExpiryDays', value: 60 },
      { key: 'contactRequiresVerification', value: true },
      { key: 'featuredCreditCost7d', value: 30 },
      { key: 'featuredCreditCost14d', value: 50 },
      { key: 'featuredCreditCost30d', value: 100 },
      { key: 'bumpCreditCost', value: 5 },
    ],
    skipDuplicates: true,
  });
  console.log('Test seed: settings OK');
}

async function seedCreditPacks() {
  const existing = await prisma.creditPack.count();
  if (existing > 0) {
    console.log('Test seed: credit packs already present, skipped');
    return;
  }

  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de créditos',
      description: 'Paquetes de créditos internos.',
      type: ProductType.ONE_TIME,
    },
  });

  const packs: { name: string; creditAmount: number; amount: string }[] = [
    { name: 'Pack Básico', creditAmount: 50, amount: '4.99' },
    { name: 'Pack Estándar', creditAmount: 150, amount: '9.99' },
    { name: 'Pack Max', creditAmount: 400, amount: '19.99' },
  ];

  for (const p of packs) {
    const pack = await prisma.creditPack.create({
      data: { name: p.name, creditAmount: p.creditAmount },
    });
    await prisma.price.create({
      data: {
        productId: packsProduct.id,
        amount: new Prisma.Decimal(p.amount),
        creditPackId: pack.id,
      },
    });
  }
  console.log('Test seed: credit packs OK (Básico/Estándar/Max)');
}

async function main() {
  await seedCategories();
  await seedSettings();
  await seedCreditPacks();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
