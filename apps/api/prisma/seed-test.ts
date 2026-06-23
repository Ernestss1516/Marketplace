// Minimal category seed for the test database.
// Called once from globalSetup (test/setup-e2e.js) via ts-node.
// Uses upsert so it is safe to run multiple times.
// Does NOT create users or listings — those are created per-suite in beforeAll.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
