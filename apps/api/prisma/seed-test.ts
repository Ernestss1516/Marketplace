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

async function seedFeaturedPrices() {
  // Check if featured listing prices already exist (no creditPackId, durationDays set)
  const existing = await prisma.price.count({
    where: { creditPackId: null, durationDays: { not: null } },
  });
  if (existing > 0) {
    console.log('Test seed: featured listing prices already present, skipped');
    return;
  }

  const featuredProduct = await prisma.product.create({
    data: {
      name: 'Destacado de anuncio',
      description: 'Destaca tu anuncio en los resultados de búsqueda.',
      type: ProductType.ONE_TIME,
    },
  });

  const variants: { durationDays: number; amount: string }[] = [
    { durationDays: 7,  amount: '2.99' },
    { durationDays: 14, amount: '4.99' },
    { durationDays: 30, amount: '7.99' },
  ];

  for (const v of variants) {
    await prisma.price.create({
      data: {
        productId: featuredProduct.id,
        amount: new Prisma.Decimal(v.amount),
        durationDays: v.durationDays,
      },
    });
  }
  console.log('Test seed: featured prices OK (7d/14d/30d)');
}

async function seedProPlans() {
  const existing = await prisma.product.count({ where: { type: ProductType.RECURRING } });

  if (existing === 0) {
    const proProduct = await prisma.product.create({
      data: {
        name: 'Plan Pro',
        description: 'Acceso completo a las funciones Pro: más anuncios activos, estadísticas y prioridad en soporte.',
        type: ProductType.RECURRING,
      },
    });

    await prisma.price.create({
      data: {
        productId: proProduct.id,
        amount: new Prisma.Decimal('9.99'),
        interval: 'MONTH',
        intervalCount: 1,
      },
    });

    await prisma.price.create({
      data: {
        productId: proProduct.id,
        amount: new Prisma.Decimal('89.99'),
        interval: 'YEAR',
        intervalCount: 1,
      },
    });

    console.log('Test seed: pro plans OK (Plan Pro 9,99 €/mes · 89,99 €/año)');
    return;
  }

  // Plans already present — fix YEAR price if it was seeded with the wrong value (79.99 → 89.99).
  const wrongYearPrice = await prisma.price.findFirst({
    where: {
      interval: 'YEAR',
      amount: new Prisma.Decimal('79.99'),
      product: { type: ProductType.RECURRING },
    },
    select: { id: true },
  });
  if (wrongYearPrice) {
    await prisma.price.update({
      where: { id: wrongYearPrice.id },
      data: { amount: new Prisma.Decimal('89.99') },
    });
    console.log('Test seed: pro annual price corrected 79,99 → 89,99 €');
  } else {
    console.log('Test seed: pro plans already present, skipped');
  }
}

async function main() {
  await seedCategories();
  await seedSettings();
  await seedCreditPacks();
  await seedFeaturedPrices();
  await seedProPlans();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
