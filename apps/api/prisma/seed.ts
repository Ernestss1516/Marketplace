import { PrismaClient, Prisma, Role, ProductType, PriceInterval } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute?: boolean;
}

interface CategorySeed {
  name: string;
  slug: string;
  order: number;
  attributeSchema: AttributeField[];
  children?: Omit<CategorySeed, 'children'>[];
}

const CATEGORIES: CategorySeed[] = [
  {
    name: 'Vehículos',
    slug: 'vehiculos',
    order: 1,
    // RC5.2b: year+km moved here from the three children (common to all).
    // Effective schema for each child = [year, km] (inherited) + own fields.
    // listing.attributes is unchanged; only where the schema is DEFINED moves.
    attributeSchema: [
      { name: 'year', label: 'Año', type: 'number', filterable: true, required: true, cardAttribute: true },
      { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
    ],
    children: [
      {
        name: 'Coches',
        slug: 'coches',
        order: 1,
        // year + km inherited from Vehículos. Effective = [year, km, brand, model, fuel, gearbox, power].
        // Card shows: "Año: 2022 · Marca: Toyota"
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true, cardAttribute: true },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: true },
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico', 'Híbrido', 'GLP'],
            filterable: true,
            required: true,
          },
          {
            name: 'gearbox',
            label: 'Cambio',
            type: 'select',
            options: ['Manual', 'Automático'],
            filterable: true,
            required: false,
          },
          { name: 'power', label: 'Potencia', type: 'number', unit: 'CV', filterable: false, required: false },
        ],
      },
      {
        name: 'Motos',
        slug: 'motos',
        order: 2,
        // year + km inherited from Vehículos. Effective = [year, km, brand, displacement].
        // Card shows: "Año: X · Marca: Y"
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true, cardAttribute: true },
          { name: 'displacement', label: 'Cilindrada', type: 'number', unit: 'cc', filterable: true, required: false },
        ],
      },
      {
        name: 'Furgonetas y camiones',
        slug: 'furgonetas',
        order: 3,
        // year + km inherited from Vehículos. Effective = [year, km, fuel].
        attributeSchema: [
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico'],
            filterable: true,
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'Inmuebles',
    slug: 'inmuebles',
    order: 2,
    attributeSchema: [],
    children: [
      {
        name: 'Pisos y apartamentos',
        slug: 'pisos',
        order: 1,
        // Card shows: "80 m² · 3 hab"
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true, cardAttribute: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true, cardAttribute: true },
          { name: 'bathrooms', label: 'Baños', type: 'number', filterable: true, required: false },
          { name: 'floor', label: 'Planta', type: 'number', filterable: false, required: false },
          { name: 'elevator', label: 'Ascensor', type: 'boolean', filterable: true, required: false },
          { name: 'garage', label: 'Garaje', type: 'boolean', filterable: true, required: false },
        ],
      },
      {
        name: 'Casas y chalets',
        slug: 'casas',
        order: 2,
        // Card shows: "120 m² · 4 hab"
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true, cardAttribute: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true, cardAttribute: true },
          { name: 'bathrooms', label: 'Baños', type: 'number', filterable: false, required: false },
          { name: 'garage', label: 'Garaje', type: 'boolean', filterable: true, required: false },
          { name: 'pool', label: 'Piscina', type: 'boolean', filterable: true, required: false },
          { name: 'garden', label: 'Jardín', type: 'boolean', filterable: false, required: false },
        ],
      },
      {
        name: 'Locales y oficinas',
        slug: 'locales',
        order: 3,
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true },
          { name: 'floor', label: 'Planta', type: 'number', filterable: false, required: false },
        ],
      },
    ],
  },
  {
    name: 'Tecnología',
    slug: 'tecnologia',
    order: 3,
    attributeSchema: [],
    children: [
      {
        name: 'Móviles y smartphones',
        slug: 'moviles',
        order: 1,
        // Card shows: "Apple · 128 GB"
        attributeSchema: [
          {
            name: 'brand',
            label: 'Marca',
            type: 'select',
            options: ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Google', 'OnePlus', 'Otro'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: false },
          {
            name: 'storage',
            label: 'Almacenamiento',
            type: 'select',
            options: ['16 GB', '32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Ordenadores',
        slug: 'ordenadores',
        order: 2,
        // Card shows: "Portátil · 16 GB"
        attributeSchema: [
          {
            name: 'itemType',
            label: 'Tipo',
            type: 'select',
            options: ['Portátil', 'Sobremesa', 'Todo en uno', 'Mini PC'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          {
            name: 'ram',
            label: 'RAM',
            type: 'select',
            options: ['4 GB', '8 GB', '16 GB', '32 GB', '64 GB'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'storage', label: 'Almacenamiento', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Electrodomésticos',
        slug: 'electrodomesticos',
        order: 3,
        // Card shows: "Tipo de electrodoméstico"
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: true, cardAttribute: true },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
        ],
      },
    ],
  },
  {
    name: 'Moda',
    slug: 'moda',
    order: 4,
    attributeSchema: [],
    children: [
      {
        name: 'Ropa',
        slug: 'ropa',
        order: 1,
        // Card shows: "Mujer · M"
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Otra'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Calzado',
        slug: 'calzado',
        order: 2,
        // Card shows: "Mujer · 38"
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Accesorios',
        slug: 'accesorios',
        order: 3,
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: false },
          { name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false },
        ],
      },
    ],
  },
  {
    name: 'Hogar y jardín',
    slug: 'hogar',
    order: 5,
    attributeSchema: [],
    children: [
      {
        name: 'Muebles',
        slug: 'muebles',
        order: 1,
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: false },
          { name: 'material', label: 'Material', type: 'text', filterable: false, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Decoración',
        slug: 'decoracion',
        order: 2,
        attributeSchema: [],
      },
      {
        name: 'Jardín',
        slug: 'jardin',
        order: 3,
        attributeSchema: [],
      },
    ],
  },
  {
    name: 'Servicios',
    slug: 'servicios',
    order: 6,
    attributeSchema: [],
    children: [
      {
        name: 'Reformas y construcción',
        slug: 'reformas',
        order: 1,
        attributeSchema: [
          { name: 'specialty', label: 'Especialidad', type: 'text', filterable: true, required: false },
          { name: 'experience', label: 'Años de experiencia', type: 'number', filterable: false, required: false },
        ],
      },
      {
        name: 'Transporte y mudanzas',
        slug: 'transporte',
        order: 2,
        attributeSchema: [
          { name: 'vehicleType', label: 'Tipo de vehículo', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Clases y formación',
        slug: 'clases',
        order: 3,
        attributeSchema: [
          { name: 'subject', label: 'Materia', type: 'text', filterable: true, required: false },
          {
            name: 'modality',
            label: 'Modalidad',
            type: 'select',
            options: ['Presencial', 'Online', 'Ambas'],
            filterable: true,
            required: false,
          },
        ],
      },
    ],
  },
];

async function seedCategories() {
  console.log('Seeding categories...');
  for (const cat of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, order: cat.order, attributeSchema: cat.attributeSchema as unknown as Prisma.InputJsonValue },
      create: { name: cat.name, slug: cat.slug, order: cat.order, attributeSchema: cat.attributeSchema as unknown as Prisma.InputJsonValue },
    });

    if (cat.children) {
      for (const child of cat.children) {
        await prisma.category.upsert({
          where: { slug: child.slug },
          update: {
            name: child.name,
            order: child.order,
            attributeSchema: child.attributeSchema as unknown as Prisma.InputJsonValue,
            parentId: parent.id,
          },
          create: {
            name: child.name,
            slug: child.slug,
            order: child.order,
            attributeSchema: child.attributeSchema as unknown as Prisma.InputJsonValue,
            parentId: parent.id,
          },
        });
        console.log(`  ✓ ${parent.name} > ${child.name}`);
      }
    } else {
      console.log(`  ✓ ${parent.name}`);
    }
  }
}

async function seedAdmin() {
  console.log('Seeding admin user...');
  const passwordHash = await bcrypt.hash('Admin1234!', BCRYPT_ROUNDS);
  await prisma.user.upsert({
    where: { email: 'admin@marketplace.es' },
    update: { role: Role.ADMIN, emailVerified: true },
    create: {
      email: 'admin@marketplace.es',
      name: 'Admin',
      slug: 'admin',
      passwordHash,
      role: Role.ADMIN,
      emailVerified: true,
    },
  });
  console.log('  ✓ admin@marketplace.es (role: ADMIN)');
}

async function seedSettings() {
  console.log('Seeding settings...');
  // createMany + skipDuplicates: only inserts keys that don't exist yet.
  // Values that an admin has already changed via the backoffice are NEVER overwritten.
  const { count } = await prisma.setting.createMany({
    data: [
      { key: 'badWordList', value: [] },
      { key: 'listingExpiryDays', value: 60 },
      { key: 'contactRequiresVerification', value: true },
      // RF.4: costes de créditos — configurables desde el backoffice sin despliegue.
      { key: 'featuredCreditCost7d', value: 30 },
      { key: 'featuredCreditCost14d', value: 50 },
      { key: 'featuredCreditCost30d', value: 100 },
      { key: 'bumpCreditCost', value: 5 },
      // RF.7: límites de anuncios activos por plan — configurables sin despliegue.
      { key: 'freeActiveListingLimit', value: 5 },
      { key: 'proActiveListingLimit', value: 20 },
      // RF.10 Bonus Pro: porcentaje de créditos extra para usuarios Pro al comprar un pack.
      { key: 'proExtraCreditsPercent', value: 20 },
      // H8.1: destacados gratis/mes que otorga la cuota de Pro (reseteo derivado, sin cron).
      { key: 'proMonthlyFeaturedQuota', value: 4 },
      // H8.5a: fixed duration of a featured grant paid from the quota (the user
      // chooses duration only when paying with credits).
      { key: 'proQuotaFeaturedDurationDays', value: 7 },
    ],
    skipDuplicates: true,
  });
  if (count > 0) {
    console.log(`  ✓ ${count} setting(s) created`);
  } else {
    console.log('  ✓ settings already present, skipped');
  }
}

async function seedBillingCatalog() {
  console.log('Seeding billing catalog...');
  const existing = await prisma.product.count();
  if (existing > 0) {
    console.log('  ✓ billing catalog already present, skipped');
    return;
  }

  const featured = await prisma.product.create({
    data: {
      name: 'Destacado de anuncio',
      description: 'Destaca tu anuncio en los resultados de búsqueda durante un período fijo.',
      type: ProductType.ONE_TIME,
    },
  });

  await prisma.price.createMany({
    data: [
      { productId: featured.id, amount: new Prisma.Decimal('2.99'), durationDays: 7 },
      { productId: featured.id, amount: new Prisma.Decimal('4.99'), durationDays: 14 },
      { productId: featured.id, amount: new Prisma.Decimal('7.99'), durationDays: 30 },
    ],
  });
  console.log('  ✓ Product: Destacado de anuncio (7/14/30 días)');

  const pro = await prisma.product.create({
    data: {
      name: 'Plan Pro',
      description: 'Accede a funciones avanzadas: más anuncios activos, más fotos y badge Pro.',
      type: ProductType.RECURRING,
    },
  });

  await prisma.price.createMany({
    data: [
      { productId: pro.id, amount: new Prisma.Decimal('9.99'), interval: PriceInterval.MONTH, intervalCount: 1 },
      { productId: pro.id, amount: new Prisma.Decimal('89.99'), interval: PriceInterval.YEAR, intervalCount: 1 },
    ],
  });
  console.log('  ✓ Product: Plan Pro (mensual/anual)');
}

async function seedCreditPacks() {
  console.log('Seeding credit packs...');
  const existing = await prisma.creditPack.count();
  if (existing > 0) {
    console.log('  ✓ credit packs already present, skipped');
    return;
  }

  // Credit pack Prices need a Product to satisfy the non-nullable productId FK.
  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de créditos',
      description: 'Paquetes de créditos internos para destacar anuncios y bumps.',
      type: ProductType.ONE_TIME,
    },
  });

  const packs: { name: string; description: string; creditAmount: number; amount: string }[] = [
    { name: 'Pack Básico', description: '50 créditos para empezar.', creditAmount: 50, amount: '4.99' },
    { name: 'Pack Estándar', description: '150 créditos con mejor relación calidad-precio.', creditAmount: 150, amount: '9.99' },
    { name: 'Pack Max', description: '400 créditos para usuarios frecuentes.', creditAmount: 400, amount: '19.99' },
  ];

  for (const p of packs) {
    const pack = await prisma.creditPack.create({
      data: { name: p.name, description: p.description, creditAmount: p.creditAmount },
    });
    await prisma.price.create({
      data: {
        productId: packsProduct.id,
        amount: new Prisma.Decimal(p.amount),
        creditPackId: pack.id,
      },
    });
    console.log(`  ✓ ${p.name} (${p.creditAmount} cr / ${p.amount} €)`);
  }
}

async function main() {
  await seedCategories();
  await seedAdmin();
  await seedSettings();
  await seedBillingCatalog();
  await seedCreditPacks();
  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
